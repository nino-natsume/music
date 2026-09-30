/*
 * build.js —— 从 index.html 生成 worker.js（Cloudflare Worker 单文件）
 *
 * 用法：
 *   node build.js
 *
 * 生成逻辑：
 *   1. 读取 index.html（播放器页面）
 *   2. 将页面 HTML 转义后嵌入 JS 模板字符串（保证 <\/script>、反引号、${} 安全）
 *   3. 拼接后端（/api /resolve /stream /cover /lyric /health + CORS + HMAC 鉴权）
 *   4. 写入 worker.js
 */
"use strict";

const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "index.html");
const DST = path.join(__dirname, "worker.js");

let body = fs.readFileSync(SRC, "utf8");

/* —— 嵌入模板字符串前的转义 —— */
body = body.replace(/\\/g, "\\\\");          // 处理页面中可能存在的反斜杠（本项目页面无，仅为安全）
body = body.replace(/`/g, "\\`");            // 反引号
body = body.replace(/\$\{/g, "\\${");        // ${ 插值
body = body.replace(/<\/script>/gi, "<\\/script>"); // 模板内结束标签转义

/* —— 后端骨架 ——
 * 注意：此段不得包含反引号 ` 或 ${ 或反斜杠转义序列 */
const BACKEND = `
/* =========================================================
   后端：Cloudflare Worker 路由
   /          播放器页面
   /api       搜索 / 榜单 / 歌单 JSON（代理 api.107211.xyz）
   /resolve   只回音频/封面的真实地址（播放器主用这条路）
   /stream    307 跳到音频地址
   /cover     307 跳到封面地址
   /lyric     歌词文本
   /health    诊断：接口能否解出地址
   ========================================================= */
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var API_BASE = "https://api.107211.xyz/api";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
};
var json = /* @__PURE__ */ __name((obj, status = 200) => new Response(JSON.stringify(obj), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", ...CORS, "cache-control": "no-store" }
}), "json");
async function hmacSha1(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(hmacSha1, "hmacSha1");
async function makeAuth(env, server, type, id) {
  const token = (env.MUSIC_TOKEN || "").trim();
  if (!token) return "";
  return hmacSha1(token, server + type + id);
}
__name(makeAuth, "makeAuth");
var buildUpstream = /* @__PURE__ */ __name((server, type, id) => {
  const up = new URL(API_BASE);
  up.searchParams.set("server", server);
  up.searchParams.set("type", type);
  up.searchParams.set("id", id);
  up.searchParams.set("r", String(Date.now()));
  return up;
}, "buildUpstream");
var withCors = /* @__PURE__ */ __name((resp) => {
  const h = new Headers(resp.headers);
  h.set("Access-Control-Allow-Origin", "*");
  return h;
}, "withCors");
/* —— 缓存卫生：按 x-cache-until 清理过期条目（10 分钟节流，静默失败） —— */
var lastCleaned = 0;
async function cleanCaches() {
  if (typeof caches === "undefined") return;
  const now = Date.now();
  if (now - lastCleaned < 10 * 60 * 1000) return;
  lastCleaned = now;
  try {
    const keys = await caches.default.keys();
    for (let i = 0; i < keys.length; i++) {
      const hit = await caches.default.match(keys[i]);
      if (!hit) continue;
      const until = Number(hit.headers.get("x-cache-until") || 0);
      if (until && until < now) await caches.default.delete(keys[i]);
    }
  } catch (e) {
  }
}
__name(cleanCaches, "cleanCaches");
async function handleApi(url, env) {
  const server = url.searchParams.get("server") || "netease";
  const type = url.searchParams.get("type") || "search";
  const id = url.searchParams.get("id") || "";
  const cacheable = type === "search" || type === "playlist";
  let cache = null;
  if (cacheable && typeof caches !== "undefined") {
    try {
      cache = caches.default;
      const ck = new Request(API_BASE + "?s=" + server + "&t=" + type + "&i=" + id);
      const hit = await cache.match(ck);
      if (hit) {
        const hh = new Headers(hit.headers);
        hh.delete("x-cache-until");
        return new Response(hit.body, { status: hit.status, headers: hh });
      }
    } catch (e) {
      cache = null;
    }
    void cleanCaches();
  }
  const up = buildUpstream(server, type, id);
  if (["lrc", "url", "pic"].includes(type)) {
    const auth = await makeAuth(env, server, type, id);
    if (auth) up.searchParams.set("auth", auth);
  }
  /* url / pic 本身是「跳转到 CDN 的一层」：绝不跟随，跟到底就是拿音频字节，
     而网易云 CDN 屏蔽 Cloudflare 出口段，2026-09 线上实测确定性 525。
     这里停在 302 上，把 Location 如实交回浏览器。 */
  const manual = type === "url" || type === "pic";
  const resp = await fetch(up.toString(), {
    headers: { "User-Agent": UA, Referer: API_BASE },
    redirect: manual ? "manual" : "follow"
  });
  if (manual && resp.status >= 300 && resp.status < 400) {
    const loc = resp.headers.get("location") || "";
    try { if (resp.body) resp.body.cancel(); } catch (e) {}
    if (!loc) return json({ error: "upstream redirect without location" }, 502);
    const h = new Headers({ "Cache-Control": "no-store", ...CORS });
    h.set("Location", new URL(loc, up.toString()).toString());
    return new Response(null, { status: 307, headers: h });
  }
  const h = withCors(resp);
  h.delete("content-encoding");
  h.delete("content-length");
  if (cache && cacheable && resp.ok) {
    try {
      const body = await resp.clone().arrayBuffer();
      const nh = new Headers(h);
      nh.set("Cache-Control", "public, max-age=300, s-maxage=300");
      nh.set("x-cache-until", String(Date.now() + 300000));
      const nresp = new Response(body, { status: resp.status, headers: nh });
      await cache.put(ck, nresp.clone());
      const rh = new Headers(h);
      rh.set("Cache-Control", "public, max-age=300, s-maxage=300");
      return new Response(body, { status: resp.status, headers: rh });
    } catch (e) {
    }
  }
  h.set("Cache-Control", "no-store");
  return new Response(resp.body, { status: resp.status, headers: h });
}
__name(handleApi, "handleApi");
/* —— 媒体地址解析（只解地址，绝不中转音频字节）——
   网易云 CDN（m80x.music.126.net 等）屏蔽 Cloudflare 出口 IP，Worker 顺着 302
   去取流必然 525；浏览器不在 Cloudflare 网络里，直连是通的。所以 Worker 只做一件事：
   用 redirect:"manual" 把地址解出来（它手上有 HMAC 密钥和兜底链），
   音频字节由浏览器直接向 CDN 要，进度条的 Range 拖动也照常可用。 */
var MEDIA_BASES = [
  "https://api.107211.xyz/api",
  "https://api.injahow.cn/meting/"
];
function mediaReq(base, server, type, id, auth) {
  const up = new URL(base);
  up.searchParams.set("server", server);
  up.searchParams.set("type", type);
  up.searchParams.set("id", id);
  up.searchParams.set("r", String(Date.now()));
  if (auth) up.searchParams.set("auth", auth);
  return up.toString();
}
/* 网易云官方 song/detail：免鉴权、不需加密，直接给出封面大图地址。
   上面所有站点都拿不到封面时的救命通道（picId 会随 p1/p2/p3 变动，不能写死域名） */
async function neteaseCover(id) {
  try {
    const r = await fetch("https://music.163.com/api/song/detail/?ids=%5B" + encodeURIComponent(id) + "%5D", { headers: { "User-Agent": UA, Referer: "https://music.163.com/" } });
    if (!r.ok) return "";
    const j = await r.json();
    const s = j && j.songs && j.songs[0];
    return s && s.album && s.album.picUrl ? String(s.album.picUrl) : "";
  } catch (e) {
    return "";
  }
}
__name(neteaseCover, "neteaseCover");
/* 向某个站点问一次「这首歌的文件在哪」：
   3xx → 读 Location；直接给二进制 → 地址就是它自己；给 JSON → 挖里面的 url。
   三条路都不成立就换下一个站点。 */
async function askOnce(base, server, type, id, auth) {
  const u = mediaReq(base, server, type, id, auth);
  let r;
  try {
    r = await fetch(u, { headers: { "User-Agent": UA }, redirect: "manual" });
  } catch (e) {
    return { url: "", note: "unreachable" };
  }
  if (r.status >= 300 && r.status < 400) {
    let loc = r.headers.get("location") || "";
    try { if (r.body) r.body.cancel(); } catch (e) {}
    if (!loc) return { url: "", note: "redirect without location" };
    try { loc = new URL(loc, u).toString(); } catch (e) { }
    return { url: loc, note: "redirect" };
  }
  if (!r.ok) return { url: "", note: "http " + r.status };
  const ct = (r.headers.get("content-type") || "").toLowerCase();
  if (ct.indexOf("audio/") === 0 || ct.indexOf("image/") === 0 || ct.indexOf("video/") === 0 || ct.indexOf("octet-stream") >= 0) {
    try { if (r.body) r.body.cancel(); } catch (e) {}
    return { url: u, note: "direct binary" };
  }
  let txt = "";
  try { txt = new TextDecoder("utf-8").decode(await r.arrayBuffer()); } catch (e) {
    return { url: "", note: "unreadable body" };
  }
  const lead = txt.trimStart();
  if (!(lead.startsWith("{") || lead.startsWith("["))) return { url: "", note: "not json" };
  const u2 = extractUrl(txt);
  return u2 ? { url: u2, note: "json" } : { url: "", note: "json without url" };
}
__name(askOnce, "askOnce");
/* 解析结果缓存 90 秒：够挡住同一次播放里的重复解析，也不至于把短效地址存太久 */
var RESOLVE_TTL = 90 * 1000;
async function resolveTarget(url, env, type) {
  const server = url.searchParams.get("server") || "netease";
  const id = url.searchParams.get("id") || "";
  if (!id) return { code: 400, error: "missing id" };
  const ck = new Request("https://resolved.invalid/" + type + "/" + server + "/" + id);
  let target = "";
  let via = "cache";
  if (typeof caches !== "undefined") {
    try {
      const hit = await caches.default.match(ck);
      if (hit) {
        const o = JSON.parse(await hit.text());
        if (o && o.u && Date.now() - o.t < RESOLVE_TTL) target = String(o.u);
      }
    } catch (e) {
    }
  }
  if (!target) {
    void cleanCaches();
    const auth = await makeAuth(env, server, type, id);
    const errs = [];
    for (let i = 0; i < MEDIA_BASES.length; i++) {
      const got = await askOnce(MEDIA_BASES[i], server, type, id, auth);
      errs.push(MEDIA_BASES[i].replace("https://", "") + ": " + got.note);
      if (got.url) { target = got.url; via = got.note; break; }
    }
    if (!target && type === "pic") {
      const pic = await neteaseCover(id);
      if (pic) { target = pic; via = "music.163.com"; }
      else errs.push("music.163.com: no cover");
    }
    if (!target) return { code: 502, error: type + " unavailable: " + errs.join("; ") };
    if (typeof caches !== "undefined") {
      try {
        await caches.default.put(ck, new Response(JSON.stringify({ u: target, t: Date.now() }), {
          headers: { "content-type": "application/json", "Cache-Control": "public, max-age=90", "x-cache-until": String(Date.now() + RESOLVE_TTL) }
        }));
      } catch (e) {
      }
    }
  }
  return { url: target, server: server, id: id, type: type, via: via };
}
__name(resolveTarget, "resolveTarget");
/* /resolve：只回地址。播放器和诊断都用它，不再经过任何字节中转。 */
async function handleResolve(url, env) {
  const r = await resolveTarget(url, env, url.searchParams.get("type") === "pic" ? "pic" : "url");
  if (!r.url) return json({ error: r.error }, r.code || 502);
  return json({ url: r.url, server: r.server, id: r.id, type: r.type, via: r.via });
}
__name(handleResolve, "handleResolve");
/* /stream 与 /cover：307 跳到解出来的地址。
   客户端的 <audio> / <img> 跟完这个跳转后自己向 CDN 发请求，Range 由浏览器原样转交。 */
async function handleMedia(url, env, kind) {
  const r = await resolveTarget(url, env, kind === "cover" ? "pic" : "url");
  if (!r.url) return json({ error: r.error }, r.code || 502);
  const h = new Headers({ "Cache-Control": kind === "cover" ? "public, max-age=3600" : "no-store", ...CORS });
  h.set("Location", r.url);
  return new Response(null, { status: 307, headers: h });
}
__name(handleMedia, "handleMedia");
function extractUrl(rawText) {
  const t = (rawText || "").trim();
  if (!t) return "";
  if (/^https?:[/][/]/i.test(t)) return t;
  const scan = /* @__PURE__ */ __name((o) => {
    if (o == null) return "";
    if (typeof o === "string") return /^https?:[/][/]/i.test(o) ? o : "";
    if (Array.isArray(o)) return scan(o[0]);
    if (typeof o === "object") {
      if (o.url) {
        const s = String(o.url);
        return /^https?:[/][/]/i.test(s) ? s : "";
      }
      if (o.data) return scan(o.data);
      if (o.lrc) return scan(o.lrc);
      if (o["0"]) return scan(o["0"]);
      for (const k of Object.keys(o)) {
        const hit = scan(o[k]);
        if (hit) return hit;
      }
    }
    return "";
  }, "scan");
  try {
    return scan(JSON.parse(t));
  } catch (e) {
    return "";
  }
}
__name(extractUrl, "extractUrl");
async function handleLyric(url, env) {
  const server = url.searchParams.get("server") || "netease";
  const id = url.searchParams.get("id") || "";
  if (!id) return json({ error: "missing id" }, 400);
  const lc = new Request("https://lrc.invalid/" + server + "/" + id);
  let lrcText = "";
  if (typeof caches !== "undefined") {
    try {
      const hit = await caches.default.match(lc);
      if (hit) lrcText = await hit.text();
    } catch (e) {
    }
  }
  if (!lrcText) {
    const up = buildUpstream(server, "lrc", id);
    const auth = await makeAuth(env, server, "lrc", id);
    if (auth) up.searchParams.set("auth", auth);
    const r1 = await fetch(up.toString(), { headers: { "User-Agent": UA } });
    if (!r1.ok) return json({ error: "upstream lrc api " + r1.status }, 502);
    lrcText = await r1.text();
    try {
      const scan = /* @__PURE__ */ __name((o) => {
        if (o == null) return "";
        if (typeof o === "string") return o;
        if (Array.isArray(o)) return scan(o[0]);
        if (typeof o === "object") {
          if (typeof o.lrc === "string") return o.lrc;
          if (o.lrc && typeof o.lrc === "object") return scan(o.lrc);
          if (o.data) return scan(o.data);
          if (o.text) return String(o.text);
        }
        return "";
      }, "scan");
      const got = scan(JSON.parse(lrcText));
      if (got) lrcText = got;
    } catch (e) {
    }
    if (typeof caches !== "undefined") {
      try {
        await caches.default.put(lc, new Response(lrcText, {
          headers: { "content-type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300", "x-cache-until": String(Date.now() + 300000) }
        }));
      } catch (e) {
      }
    }
  } else {
    void cleanCaches();
  }
  return new Response(lrcText, {
    headers: { "content-type": "text/plain; charset=utf-8", ...CORS, "cache-control": "public, max-age=300" }
  });
}
__name(handleLyric, "handleLyric");

/* 诊断端点 /health：判定「接口能不能把播放地址解出来」。
   关键改动：不再向 CDN 要字节（旧版用 Range: bytes=0-0 探测，失败必 525，
   整轮 /health 要 7 秒以上，前端 4 秒超时后判定链路不可用，于是全部走代理、全部失败）。
   现在停在 302 上，/health 是毫秒级的；音频/封面本身能不能放，
   取决于浏览器直连 CDN，那不是 Worker 能测、也不该由 Worker 代劳的事。 */
var PROBE_ID = "210049";
async function handleHealth(env) {
  const u = new URL("https://probe.invalid/health");
  const pu = new URL(u.toString());
  pu.searchParams.set("server", "netease");
  pu.searchParams.set("type", "url");
  pu.searchParams.set("id", PROBE_ID);
  const pp = new URL(u.toString());
  pp.searchParams.set("server", "netease");
  pp.searchParams.set("type", "pic");
  pp.searchParams.set("id", PROBE_ID);
  const both = await Promise.all([resolveTarget(pu, env, "url"), resolveTarget(pp, env, "pic")]);
  const audioOk = !!both[0].url;
  const coverOk = !!both[1].url;
  const state = audioOk && coverOk ? "ok" : !audioOk && !coverOk ? "down" : "degraded";
  return json({
    state: state,
    audio: audioOk,
    cover: coverOk,
    audioVia: both[0].via || (audioOk ? "" : both[0].error || "unavailable"),
    coverVia: both[1].via || (coverOk ? "" : both[1].error || "unavailable"),
    media: "client requests CDN directly; worker only resolves addresses",
    detail: [both[0].via || both[0].error || "", both[1].via || both[1].error || ""].filter(Boolean)
  });
}
__name(handleHealth, "handleHealth");

var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    const p = url.pathname;
    if (p === "/" || p === "/index.html") {
      // 回退：不再 gzip 压缩 HTML。
      // 曾用 CompressionStream 压缩并以 content-encoding:gzip 返回，但未检查
      // Accept-Encoding，导致未声明 gzip 的客户端收到压缩字节 → 整页乱码。
      const hb = { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300, s-maxage=300", ...CORS };
      return new Response(HTML, { headers: hb });
    }
    if (p === "/api" || p.startsWith("/api/")) return handleApi(url, env);
    if (p === "/resolve") return handleResolve(url, env);
    if (p === "/stream") return handleMedia(url, env, "stream");
    if (p === "/cover") return handleMedia(url, env, "cover");
    if (p === "/lyric") return handleLyric(url, env);
    if (p === "/health") return handleHealth(env);
    return new Response("Not Found", { status: 404, headers: CORS });
  }
};
export {
  worker_default as default
};
`;

const out = `/* =========================================================
 * 云音乐 · Web 播放器 —— Cloudflare Worker 单文件
 * 由 build.js 从 index.html 自动生成（勿手工改动本文件）
 * 页面功能：
 *   - 单页：搜索（输入即搜）+ 登录 + 播放 + 全页歌词栏（左图右词）
 *   - 无多余的推荐 / 歌单 / 排行榜等功能
 * 后端路由：/api /resolve /stream /cover /lyric /health
 * 媒体策略：Worker 只解析地址（redirect:"manual"），音频与封面由浏览器直连 CDN。
 *   网易云 CDN 屏蔽 Cloudflare 出口 IP，Worker 中转字节必然 525，别再走那条路。
 * ========================================================= */
var HTML = \`${body}\`;
${BACKEND}
`;

fs.writeFileSync(DST, out, "utf8");
console.log("worker.js generated, bytes:", out.length);