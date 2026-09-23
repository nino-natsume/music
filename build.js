/*
 * build.js —— 从 index.html 生成 worker.js（Cloudflare Worker 单文件）
 *
 * 用法：
 *   node build.js
 *
 * 生成逻辑：
 *   1. 读取 index.html（播放器页面）
 *   2. 将页面 HTML 转义后嵌入 JS 模板字符串（保证 <\/script>、反引号、${} 安全）
 *   3. 拼接 1.txt 中的后端（/api /stream /cover /lyric + CORS + HMAC 鉴权）
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

/* —— 后端骨架（来源：d:/desktop/1.txt）——
 * 注意：此段不得包含反引号 ` 或 ${ 或反斜杠转义序列 */
const BACKEND = `
/* =========================================================
   后端：Cloudflare Worker 路由
   /          播放器页面
   /api       搜索 / 榜单 / 歌单 JSON（代理 api.107211.xyz）
   /stream    音频流
   /cover     封面图
   /lyric     歌词文本
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
      if (hit) return hit;
    } catch (e) {
      cache = null;
    }
  }
  const up = buildUpstream(server, type, id);
  if (["lrc", "url", "pic"].includes(type)) {
    const auth = await makeAuth(env, server, type, id);
    if (auth) up.searchParams.set("auth", auth);
  }
  const resp = await fetch(up.toString(), { headers: { "User-Agent": UA, Referer: API_BASE } });
  const h = withCors(resp);
  h.delete("content-encoding");
  h.delete("content-length");
  if (cache && cacheable && resp.ok) {
    try {
      const body = await resp.clone().arrayBuffer();
      const nh = new Headers(h);
      nh.set("Cache-Control", "public, max-age=300");
      const nresp = new Response(body, { status: resp.status, headers: nh });
      await cache.put(ck, nresp.clone());
      return nresp;
    } catch (e) {
    }
  }
  h.set("Cache-Control", "no-store");
  return new Response(resp.body, { status: resp.status, headers: h });
}
__name(handleApi, "handleApi");
async function resolveBinary(url, env, kind) {
  const server = url.searchParams.get("server") || "netease";
  const id = url.searchParams.get("id") || "";
  if (!id) return json({ error: "missing id" }, 400);
  const type = kind === "stream" ? "url" : "pic";
  const up = buildUpstream(server, type, id);
  const auth = await makeAuth(env, server, type, id);
  if (auth) up.searchParams.set("auth", auth);
  const r1 = await fetch(up.toString(), { headers: { "User-Agent": UA } });
  if (!r1.ok) return json({ error: "upstream " + type + " api " + r1.status }, 502);
  const ct1 = (r1.headers.get("content-type") || "").toLowerCase();
  if (ct1.startsWith("audio/") || ct1.startsWith("image/") || ct1.startsWith("video/") || ct1.includes("octet-stream")) {
    const h = withCors(r1);
    h.delete("content-encoding");
    h.delete("content-length");
    h.set("Cache-Control", kind === "cover" ? "public, max-age=86400" : "no-store");
    return new Response(r1.body, { status: r1.status, headers: h });
  }
  const buf = new Uint8Array(await r1.arrayBuffer());
  const lead = new TextDecoder("utf-8").decode(buf.slice(0, 8)).trimStart();
  if (lead.startsWith("{") || lead.startsWith("[")) {
    const target = extractUrl(new TextDecoder("utf-8").decode(buf));
    if (!target) return json({ error: kind + " url not found" }, 502);
    const r2 = await fetch(target, { headers: { "User-Agent": UA } });
    const h2 = withCors(r2);
    h2.set("Cache-Control", kind === "cover" ? "public, max-age=86400" : "no-store");
    return new Response(r2.body, { status: r2.status, headers: h2 });
  }
  const h3 = { "content-type": kind === "stream" ? "audio/mpeg" : "image/jpeg", ...CORS };
  h3["Cache-Control"] = kind === "cover" ? "public, max-age=86400" : "no-store";
  return new Response(buf, { status: 200, headers: h3 });
}
__name(resolveBinary, "resolveBinary");
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
  const up = buildUpstream(server, "lrc", id);
  const auth = await makeAuth(env, server, "lrc", id);
  if (auth) up.searchParams.set("auth", auth);
  const r1 = await fetch(up.toString(), { headers: { "User-Agent": UA } });
  if (!r1.ok) return json({ error: "upstream lrc api " + r1.status }, 502);
  let lrcText = await r1.text();
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
  return new Response(lrcText, {
    headers: { "content-type": "text/plain; charset=utf-8", ...CORS, "cache-control": "no-store" }
  });
}
__name(handleLyric, "handleLyric");

var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    const p = url.pathname;
    if (p === "/" || p === "/index.html") {
      return new Response(HTML, {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...CORS }
      });
    }
    if (p === "/api" || p.startsWith("/api/")) return handleApi(url, env);
    if (p === "/stream") return resolveBinary(url, env, "stream");
    if (p === "/cover") return resolveBinary(url, env, "cover");
    if (p === "/lyric") return handleLyric(url, env);
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
 *   - 打开网站默认展示：推荐 / 猜你想听 / 推荐歌单 / 排行榜
 *   - 搜索栏默认隐藏，搜索出结果时显示
 *   - 底部播放器持续放歌，进度条置于播放组件上方
 *   - 播放时点击左下角歌曲图片 → 全页面歌词栏（网云风格）
 *   - 登录：oauth.107211.xyz 第三方授权登录
 * 后端路由：/api /stream /cover /lyric（代理 api.107211.xyz）
 * ========================================================= */
var HTML = \`${body}\`;
${BACKEND}
`;

fs.writeFileSync(DST, out, "utf8");
console.log("worker.js generated, bytes:", out.length);