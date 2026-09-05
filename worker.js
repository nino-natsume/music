/**
 * Music Box — Cloudflare Worker 音乐播放器（单文件全功能）
 * ============================================================
 * 一个 worker.js 包含：服务端（API 代理/鉴权/流媒体）+ 完整前端（HTML/CSS/JS）。
 * 部署即用，无需任何本地服务、无需构建步骤。
 *
 * 部署（任选）：
 *   1) Cloudflare Dashboard → Workers & Pages → Create → Worker
 *      → 粘贴本文件全部内容 → Save and Deploy
 *   2) 或绑定 GitHub 仓库（main 分支）自动构建部署
 *
 * 端点：
 *   GET /            播放器页面
 *   GET /api         透明代理 https://api.107211.xyz/api（自动补 auth 与 r）
 *   GET /stream      音频流   ?server=&id=
 *   GET /cover       封面图   ?server=&id=
 *   GET /lyric       歌词     ?server=&id=
 *
 * 环境变量：
 *   MUSIC_TOKEN  上游服务商 HMAC-SHA1 密钥（auth = HMAC-SHA1(token, server+type+id)）
 *                lrc/url/pic 需要 auth；留空则匿名（search/song 可用）
 *
 * 上游：https://api.107211.xyz/api
 *   server: netease | tencent | kugou | baidu | kuwo
 *   type  : search | song | album | artist | playlist | lrc | url | pic
 */

const API_BASE = "https://api.107211.xyz/api";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS, "cache-control": "no-store" },
  });

async function hmacSha1(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function makeAuth(env, server, type, id) {
  const token = (env.MUSIC_TOKEN || "").trim();
  if (!token) return "";
  return hmacSha1(token, server + type + id);
}
const buildUpstream = (server, type, id) => {
  const up = new URL(API_BASE);
  up.searchParams.set("server", server);
  up.searchParams.set("type", type);
  up.searchParams.set("id", id);
  up.searchParams.set("r", String(Date.now()));
  return up;
};
const withCors = (resp) => {
  const h = new Headers(resp.headers);
  h.set("Access-Control-Allow-Origin", "*");
  return h;
};

// ---------- 端点：/api（透明代理） ----------

async function handleApi(url, env) {
  const server = url.searchParams.get("server") || "netease";
  const type = url.searchParams.get("type") || "search";
  const id = url.searchParams.get("id") || "";
  const up = buildUpstream(server, type, id);
  if (["lrc", "url", "pic"].includes(type)) {
    const auth = await makeAuth(env, server, type, id);
    if (auth) up.searchParams.set("auth", auth);
  }
  const resp = await fetch(up.toString(), { headers: { "User-Agent": UA, Referer: API_BASE } });
  const h = withCors(resp);
  h.delete("content-encoding"); // body 已被 fetch 解码，剔除压缩/长度头避免二次解压出错
  h.delete("content-length");
  h.set("Cache-Control", "no-store");
  return new Response(resp.body, { status: resp.status, headers: h });
}

// ---------- 端点：/stream /cover（二进制或 URL 双重兼容） ----------

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

// 从上游 JSON 文本中递归提取第一个 http 链接
function extractUrl(rawText) {
  const t = (rawText || "").trim();
  if (!t) return "";
  if (/^https?:[/][/]/i.test(t)) return t;
  const scan = (o) => {
    if (o == null) return "";
    if (typeof o === "string") return /^https?:[/][/]/i.test(o) ? o : "";
    if (Array.isArray(o)) return scan(o[0]);
    if (typeof o === "object") {
      if (o.url) { const s = String(o.url); return /^https?:[/][/]/i.test(s) ? s : ""; }
      if (o.data) return scan(o.data);
      if (o.lrc) return scan(o.lrc);
      if (o["0"]) return scan(o["0"]);
      for (const k of Object.keys(o)) {
        const hit = scan(o[k]);
        if (hit) return hit;
      }
    }
    return "";
  };
  try { return scan(JSON.parse(t)); } catch (e) { return ""; }
}

// ---------- 端点：/lyric ----------

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
    const scan = (o) => {
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
    };
    const got = scan(JSON.parse(lrcText));
    if (got) lrcText = got;
  } catch (e) { /* 纯文本 LRC，原样返回 */ }
  return new Response(lrcText, {
    headers: { "content-type": "text/plain; charset=utf-8", ...CORS, "cache-control": "no-store" },
  });
}

// ============================================================
//  前端：HTML + CSS + JS（全部内联于 worker.js，单文件部署）
// ============================================================

const HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Music Box</title>
<style>
:root{
  --pink:#ffb7c5;--pink2:#ff8fa3;--pink3:#ffadc0;--pink-deep:#e0557a;
  --card:rgba(255,255,255,.85);--border:rgba(255,183,197,.45);
  --text:#1f2937;--text2:#6b7280;
  --shadow:0 6px 20px rgba(255,143,163,.14);
  --shadow-sm:0 2px 10px rgba(255,143,163,.12);
  --theme:#e0557a; --theme-glow:rgba(255,143,163,.55);
}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif;background:linear-gradient(180deg,#fefafc 0%,#fdf3f7 45%,#fbeef3 100%);background-attachment:fixed;color:var(--text);position:fixed;inset:0;width:100%;height:100%;display:flex;flex-direction:column;overflow:hidden}
button{cursor:pointer;border:none;background:none;color:inherit;font:inherit}
input,select{font:inherit;color:inherit}

/* ── 顶部搜索栏 ── */
.top{display:flex;align-items:center;gap:14px;padding:12px 20px;background:rgba(255,255,255,.82);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-bottom:1px solid var(--border);flex-wrap:wrap;z-index:50}
.top h1{font-size:18px;letter-spacing:1px;background:linear-gradient(90deg,var(--pink2),var(--pink-deep));-webkit-background-clip:text;background-clip:text;color:transparent;white-space:nowrap}
.search-bar{display:flex;gap:8px;flex:1 1 260px;min-width:260px}
.sbar select{background:#fff;border:1px solid var(--border);border-radius:10px;padding:8px 10px;color:var(--text);outline:none;box-shadow:var(--shadow-sm)}
.sbar input{flex:1;min-width:110px;background:#fff;border:1px solid var(--border);border-radius:10px;padding:8px 14px;color:var(--text);outline:none;transition:border-color .2s,box-shadow .2s;box-shadow:var(--shadow-sm)}
.sbar input::placeholder{color:#b0a3a8}
.sbar input:focus{border-color:var(--pink2);box-shadow:0 0 0 3px rgba(255,143,163,.18)}
.btn-pill{background:linear-gradient(135deg,var(--pink),var(--pink2));border-radius:10px;padding:8px 20px;color:#fff;font-weight:700;text-shadow:0 1px 2px rgba(224,85,122,.35);box-shadow:var(--shadow-sm);transition:transform .15s,box-shadow .2s}
.btn-pill:hover{transform:translateY(-1px);box-shadow:0 6px 18px rgba(255,143,163,.4)}
.btn-pill:active{transform:scale(.96)}

/* ── 主区：歌词面板（外围颜色随封面主题色动态变化） ── */
.main{flex:1;display:flex;flex-direction:column;gap:16px;padding:16px 20px 76px;overflow:hidden}
.lrc-wrap{flex:1;display:flex;flex-direction:column;min-height:0;background:var(--card);border:1px solid var(--border);border-radius:16px;box-shadow:var(--shadow);overflow:hidden;position:relative}
.lrc-wrap .list-head{display:flex;justify-content:space-between;align-items:center;padding:11px 16px;font-size:13px;color:var(--text2);border-bottom:1px solid var(--border)}
.lrc-wrap .list-head b{color:var(--theme,#e0557a)}
#lrcNow{font-size:12px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:62%}
.lrc-box{flex:1;overflow-y:auto;text-align:center;padding:28px 10px;scrollbar-width:none}
.lrc-box::-webkit-scrollbar{display:none}
.lrc-line{padding:10px 8px;text-align:center;font-size:19px;line-height:1.6;color:rgba(31,41,55,.32);cursor:pointer;opacity:.55;transform:scale(.95);transform-origin:center;transition:opacity .45s ease,transform .45s ease,color .45s ease,text-shadow .45s ease;animation:lrcIn .45s ease both}
.lrc-line:hover{color:var(--theme,#e0557a)}
.lrc-line.active{color:#1f2937;font-size:23px;font-weight:700;opacity:1;transform:scale(1.05);animation:lrcBreath 2.6s ease-in-out infinite}
@keyframes lrcIn{from{opacity:0;transform:translateY(12px) scale(.92)}to{opacity:.55;transform:translateY(0) scale(.95)}}
@keyframes lrcBreath{0%,100%{text-shadow:0 2px 22px var(--theme-glow,rgba(255,143,163,.55))}50%{text-shadow:0 2px 36px var(--theme-glow,rgba(255,143,163,.95))}}
.lrc-line.meta{color:var(--text2);font-size:13px;cursor:default}
.lrc-line .lc{word-break:break-word}
.lrc-line .lt{font-size:.72em;line-height:1.5;opacity:.62;margin-top:3px;transition:opacity .45s ease}
.lrc-line.active .lt{opacity:.85}

/* ── 底部播放条 ── */
.player{position:fixed;left:0;right:0;bottom:0;display:flex;align-items:center;gap:12px;padding:10px 20px;padding-bottom:calc(10px + env(safe-area-inset-bottom));background:rgba(255,255,255,.88);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border-top:1px solid var(--border);box-shadow:0 -6px 24px rgba(255,143,163,.12);flex-wrap:wrap;z-index:100}
.player img{width:54px;height:54px;border-radius:12px;object-fit:cover;background:#fff;box-shadow:0 4px 14px rgba(255,143,163,.3)}
.p-meta{width:150px;min-width:0}
.p-meta .t{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.p-meta .a{font-size:12px;color:var(--text2);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.p-ctrl{display:flex;align-items:center;gap:4px}
.p-ctrl button{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;transition:background .15s,transform .15s}
.p-ctrl button:hover{background:rgba(255,143,163,.15)}
.p-ctrl button:active{transform:scale(.9)}
#btnPlay{width:44px;height:44px;background:linear-gradient(135deg,var(--pink),var(--pink2));font-size:17px;color:#fff;box-shadow:0 4px 14px rgba(255,143,163,.45)}
#btnPlay:hover{filter:brightness(1.06)}
.p-prog{flex:1;display:flex;align-items:center;gap:8px;min-width:110px}
.p-prog span{font-size:12px;color:var(--text2);font-variant-numeric:tabular-nums;min-width:38px;text-align:center}
input[type=range]{-webkit-appearance:none;appearance:none;height:5px;border-radius:4px;background:rgba(31,41,55,.12);outline:none;cursor:pointer}
input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;background:var(--pink2);box-shadow:0 0 8px rgba(255,143,163,.6)}
input[type=range]::-moz-range-thumb{width:14px;height:14px;border:none;border-radius:50%;background:var(--pink2)}
#seek{flex:1}
#vol{width:80px}
.p-side{display:flex;align-items:center;gap:4px}
.p-side button{width:34px;height:34px;border-radius:10px;font-size:14px;display:flex;align-items:center;justify-content:center;transition:background .15s,transform .2s}
.p-side button:hover{background:rgba(255,143,163,.15)}
.p-side button.on{background:rgba(255,143,163,.22);color:var(--pink-deep)}
#btnLrc.on{transform:rotate(-3deg) scale(1.05)}

/* ── 全屏搜索结果页（fixed 覆盖层，不参与主布局） ── */
.lrc-overlay{position:fixed;inset:0;z-index:200;display:flex;flex-direction:column;opacity:0;transform:translateY(30px) scale(.98);pointer-events:none;transition:opacity .38s cubic-bezier(.22,.61,.36,1),transform .38s cubic-bezier(.22,.61,.36,1)}
.lrc-overlay.hidden{display:none}
.lrc-overlay.show{opacity:1;transform:none;pointer-events:auto}
.lrc-bg{position:absolute;inset:-50px;background-size:cover;background-position:center;filter:blur(52px) saturate(1.4);transform:scale(1.2);transition:background-image .4s ease}
.lrc-scrim{position:absolute;inset:0;background:linear-gradient(180deg,rgba(254,249,251,.72) 0%,rgba(254,249,251,.86) 45%,rgba(252,242,246,.97) 100%)}
.lrc-top{position:relative;z-index:2;display:flex;align-items:center;gap:14px;padding:16px 20px;padding-top:calc(16px + env(safe-area-inset-top))}
.lrc-close{width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,.7);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:20px;color:var(--pink-deep);box-shadow:var(--shadow-sm);transition:transform .3s ease,background .2s}
.lrc-close:hover{transform:translateY(-2px) rotate(-8deg);background:#fff}
.lrc-meta{min-width:0}
.lrc-meta .t{font-size:16px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lrc-meta .a{font-size:12px;color:var(--text2);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ov-list-wrap{position:relative;z-index:2;flex:1;min-height:0;display:flex;flex-direction:column;margin:0 16px 10px;background:rgba(255,255,255,.9);border:1px solid var(--border);border-radius:16px;box-shadow:var(--shadow);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);overflow:hidden}
.ov-list-wrap .list-head{display:flex;justify-content:space-between;align-items:center;padding:11px 16px;font-size:13px;color:var(--text2);border-bottom:1px solid var(--border)}
.ov-list-wrap .list-head b{color:var(--pink-deep)}
#stat{font-size:12px;color:var(--text2)}
#list{flex:1;overflow-y:auto;padding:8px;list-style:none}
#list::-webkit-scrollbar{width:8px}
#list::-webkit-scrollbar-thumb{background:rgba(255,143,163,.3);border-radius:6px}
#list li{display:flex;align-items:center;gap:14px;padding:10px 14px;border-radius:12px;cursor:pointer;transition:background .18s,transform .15s}
#list li:hover{background:rgba(255,143,163,.08);transform:translateX(2px)}
#list li.active{background:rgba(255,143,163,.14);box-shadow:inset 0 0 0 1px rgba(255,183,197,.5)}
#list li .num{width:26px;text-align:center;font-size:12px;color:var(--text2);font-variant-numeric:tabular-nums}
#list li.active .num{color:var(--pink-deep)}
#list li .nm{flex:1;min-width:0}
#list li .t{font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#list li .a{font-size:12px;color:var(--text2);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#list li .play-badge{display:none;font-size:12px;color:var(--pink-deep)}
#list li.active .play-badge{display:inline}
#list .empty{padding:50px 20px;text-align:center;color:var(--text2);font-size:14px}
.lrc-bar{position:relative;z-index:2;display:flex;align-items:center;gap:12px;padding:12px 20px;padding-bottom:calc(12px + env(safe-area-inset-bottom));background:rgba(255,255,255,.82);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-top:1px solid var(--border)}
.lrc-bar button{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;transition:background .15s,transform .15s}
.lrc-bar button:hover{background:rgba(255,143,163,.15)}
.lrc-bar button:active{transform:scale(.9)}
#lrcPlay{width:46px;height:46px;background:linear-gradient(135deg,var(--pink),var(--pink2));font-size:18px;color:#fff;box-shadow:0 4px 16px rgba(255,143,163,.5)}
#lrcPlay:hover{filter:brightness(1.06)}
.lrc-prog{flex:1;display:flex;align-items:center;gap:8px;min-width:100px}
.lrc-prog span{font-size:12px;color:var(--text2);font-variant-numeric:tabular-nums;min-width:38px;text-align:center}
#lrcSeek{flex:1}

/* ── 自适应：手机 / 平板 / 桌面 / 横屏 ── */
@media (max-width:768px){
  .top{padding:10px 12px}
  .top h1{font-size:15px}
  .main{padding:12px 12px 76px}
  .player{gap:8px;padding:8px 12px}
  .player img{width:44px;height:44px}
  .p-meta{width:100px}
  .p-meta .a{font-size:11px}
  .p-ctrl button{width:32px;height:32px}
  #btnPlay{width:40px;height:40px}
  .p-prog{min-width:80px}
  #vol{width:54px}
  .p-side button{width:30px;height:30px}
  .lrc-box{padding:20px 8px}
  .lrc-line{font-size:16px}
  .lrc-line.active{font-size:20px}
  .lrc-bar{gap:8px;padding:8px 12px}
  .lrc-bar button{width:34px;height:34px}
  #lrcPlay{width:42px;height:42px}
}
@media (max-width:560px){
  .search-bar{flex:1 1 100%;min-width:0}
  .sbar input{min-width:80px}
  .btn-pill{padding:8px 16px}
  .main{padding-bottom:120px}
  .player{row-gap:6px}
  .player img{width:40px;height:40px;border-radius:10px}
  .p-meta{flex:1;min-width:40px}
  .p-ctrl{gap:2px}
  .p-ctrl button{width:30px;height:30px}
  #btnPlay{width:36px;height:36px}
  .p-side #vol,.p-side #btnMode{display:none}
  .p-prog{flex:1 1 100%;order:9;min-width:0}
  .lrc-top{padding:12px 12px}
  .lrc-box{padding:14px 6px}
  .lrc-line{font-size:15px}
  .lrc-line.active{font-size:18px}
  .lrc-prog span{min-width:30px}
}
@media (max-width:400px){
  .top h1{font-size:13px}
  .p-meta{max-width:70px}
  .p-ctrl{gap:0}
  .lrc-bar button{width:30px;height:30px}
  #lrcPlay{width:38px;height:38px}
}
@media (max-height:560px){
  .lrc-box{padding:10px 8px}
  .lrc-line{font-size:14px}
  .lrc-line.active{font-size:17px}
}
/* ── 桌面：搜索结果变成歌词栏右侧固定侧边栏 ── */
@media (min-width:769px){
  .main{flex-direction:row;align-items:stretch}
  .lrc-wrap{flex:1;min-width:0}
  .lrc-overlay{position:relative;inset:auto;z-index:10;flex:0 0 320px;min-width:320px;max-width:360px;opacity:1;transform:none;pointer-events:auto;display:flex;border:1px solid var(--border);border-radius:16px;box-shadow:var(--shadow);overflow:hidden;background:rgba(255,255,255,.92);transition:none}
  .lrc-overlay.show{opacity:1;transform:none;pointer-events:auto}
  .lrc-overlay.hidden{display:none}
  .ov-list-wrap{margin:12px 12px 8px}
  .lrc-top{padding:14px 16px;padding-top:calc(14px + env(safe-area-inset-top))}
  .lrc-bar{padding:10px 16px}
}
@media (min-width:1200px){
  .main{max-width:1400px;margin:0 auto;width:100%}
  .lrc-line{font-size:21px}
  .lrc-line.active{font-size:26px}
}
</style>
</head>
<body>

<div class="top">
  <h1>♪ Music Box</h1>
  <div class="search-bar sbar">
    <select id="selServer">
      <option value="netease">网易云</option>
      <option value="tencent">QQ音乐</option>
      <option value="kugou">酷狗</option>
      <option value="baidu">百度</option>
      <option value="kuwo">酷我</option>
    </select>
    <input id="kw" type="text" placeholder="搜索歌曲 / 歌手 / 专辑……" autocomplete="off">
    <button class="btn-pill" id="btnSearch">搜索</button>
  </div>
</div>

<main class="main">
  <section class="lrc-wrap" id="lrcPanelMain">
    <div class="list-head"><b>歌词</b><span id="lrcNow">♫ 播放后自动加载</span></div>
    <div class="lrc-box" id="lrcBox"><div class="lrc-line meta">搜索并播放一首歌，歌词会显示在这里~</div></div>
  </section>
  <div class="lrc-overlay hidden" id="lrcOverlay">
    <div class="lrc-bg" id="lrcBg"></div>
    <div class="lrc-scrim"></div>
    <div class="lrc-top">
      <button class="lrc-close" id="lrcClose" title="收起">↓</button>
      <div class="lrc-meta">
        <div class="t">♪ 搜索结果</div>
        <div class="a" id="ovStat">输入关键词搜索</div>
      </div>
    </div>
    <div class="ov-list-wrap">
      <div class="list-head"><b>搜索结果</b><span id="stat"></span></div>
      <ul id="list"><li class="empty">输入关键词，开始你的音乐之旅~</li></ul>
    </div>
    <div class="lrc-bar">
      <button id="lrcPrev" title="上一首">⏮</button>
      <button id="lrcPlay" title="播放/暂停">▶</button>
      <button id="lrcNext" title="下一首">⏭</button>
      <div class="lrc-prog">
        <span id="lrcCur">00:00</span>
        <input id="lrcSeek" type="range" min="0" max="1000" value="0">
        <span id="lrcDur">00:00</span>
      </div>
    </div>
  </div>
</main>

<footer class="player">
  <img id="cover" alt="cover" src="https://t.alcy.cc/tx">
  <div class="p-meta">
    <div class="t" id="pTitle">未在播放</div>
    <div class="a" id="pAuthor"></div>
  </div>
  <div class="p-ctrl">
    <button id="btnPrev" title="上一首">⏮</button>
    <button id="btnPlay" title="播放/暂停">▶</button>
    <button id="btnNext" title="下一首">⏭</button>
  </div>
  <div class="p-prog">
    <span id="cur">00:00</span>
    <input id="seek" type="range" min="0" max="1000" value="0">
    <span id="dur">00:00</span>
  </div>
  <div class="p-side">
    <input id="vol" type="range" min="0" max="100" value="80" title="音量">
    <button id="btnMode" title="顺序播放">🔁</button>
    <button id="btnLrc" title="搜索结果" class="">≡</button>
  </div>
</footer>

<audio id="audio" preload="metadata"></audio>

<script>
/* ================= 全局状态 ================= */
var S = { server: "netease", list: [], idx: -1, mode: 0, lrc: [], lrcIdx: -1 };
var audio = document.getElementById("audio");
var modeNames = ["顺序播放", "列表循环", "单曲循环"];
var modeIcons = ["🔁", "🔃", "🔂"];

/* ================= 工具 ================= */
function apiUrl(type, id) {
  return "/api?server=" + encodeURIComponent(S.server) + "&type=" + encodeURIComponent(type) + "&id=" + encodeURIComponent(id);
}
function proxyUrl(kind, id) {
  return "/" + kind + "?server=" + encodeURIComponent(S.server) + "&id=" + encodeURIComponent(id);
}
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
function fmt(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  var m = Math.floor(sec / 60), s = sec % 60;
  return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
}
function songTitle(it) { return it.title || it.name || "未知歌曲"; }
function songAuthor(it) {
  return Array.isArray(it.author) ? it.author.join(" / ") : (it.author || it.artist || "");
}

/* ================= 搜索 ================= */
function search() {
  var kw = document.getElementById("kw").value.trim();
  if (!kw) return;
  S.server = document.getElementById("selServer").value;
  document.getElementById("stat").textContent = "搜索中……";
  fetch(apiUrl("search", kw))
    .then(function (r) { return r.json(); })
    .then(function (data) {
      S.list = Array.isArray(data) ? data : (data && data.data) || [];
      S.idx = -1;
      document.getElementById("stat").textContent = S.list.length + " 首";
      document.getElementById("ovStat").textContent = S.list.length > 0 ? "共 " + S.list.length + " 首" : "没有找到结果";
      renderList();
      openList();
    })
    .catch(function (e) {
      var msg = (e && e.message) ? e.message : String(e);
      document.getElementById("stat").textContent = "搜索失败：" + msg;
      document.getElementById("ovStat").textContent = "搜索失败";
      var ul = document.getElementById("list");
      ul.innerHTML = "";
      var li = document.createElement("li");
      li.className = "empty";
      li.textContent = "请求失败：" + msg + "。请确认 Worker 已正确部署";
      ul.appendChild(li);
      openList();
    });
}

/* ================= 列表 ================= */
function itemId(it, i) {
  if (it && it.id) return String(it.id);
  var u = (it && (it.url || it.pic || it.lrc)) || "";
  try {
    var q = new URL(u, location.href).searchParams;
    if (q.get("id")) return q.get("id");
  } catch (e) {}
  return String(i);
}
function renderList() {
  var ul = document.getElementById("list");
  ul.innerHTML = "";
  if (!S.list || !S.list.length) {
    var li = document.createElement("li");
    li.className = "empty";
    li.textContent = "没有结果，换个关键词或音乐源试试";
    ul.appendChild(li);
    return;
  }
  S.list.forEach(function (it, i) {
    var li = document.createElement("li");
    if (i === S.idx) li.className = "active";
    var num = document.createElement("span");
    num.className = "num";
    num.textContent = String(i + 1).padStart(2, "0");
    var nm = document.createElement("div");
    nm.className = "nm";
    var t = document.createElement("div");
    t.className = "t";
    t.textContent = songTitle(it);
    var a = document.createElement("div");
    a.className = "a";
    a.textContent = songAuthor(it) || "未知歌手";
    nm.appendChild(t);
    nm.appendChild(a);
    var badge = document.createElement("span");
    badge.className = "play-badge";
    badge.textContent = "▶";
    li.appendChild(num);
    li.appendChild(nm);
    li.appendChild(badge);
    li.onclick = function () { playItem(i); };
    ul.appendChild(li);
  });
}

/* ================= 播放 ================= */
function playItem(i) {
  var it = S.list[i];
  if (!it) return;
  S.idx = i;
  S.lrc = []; S.lrcIdx = -1;
  renderList();
  document.getElementById("pTitle").textContent = songTitle(it);
  document.getElementById("pAuthor").textContent = songAuthor(it);
  var id = itemId(it, i);
  var coverEl = document.getElementById("cover");
  coverEl.src = proxyUrl("cover", id);
  audio.src = proxyUrl("stream", id);
  coverEl.onload = function () { extractTheme(applyTheme); };
  coverEl.onerror = function () { coverEl.src = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="112" height="112"><rect width="112" height="112" rx="24" fill="#fff7f9"/><rect x="1" y="1" width="110" height="110" rx="23" fill="none" stroke="#ffb7c5" stroke-width="2"/><text x="56" y="66" font-size="30" text-anchor="middle" fill="#e0557a">♪</text></svg>'); };
  audio.play().then(function () { setPlaying(true); }).catch(function () {});
  document.getElementById("lrcNow").textContent = songTitle(it) + " - " + songAuthor(it);
  document.getElementById("lrcBg").style.backgroundImage = "url('" + proxyUrl("cover", id) + "')";
  loadLrc(id);
}
function setPlaying(on) {
  document.getElementById("btnPlay").textContent = on ? "⏸" : "▶";
  var lp = document.getElementById("lrcPlay");
  if (lp) lp.textContent = on ? "⏸" : "▶";
}

/* ================= 封面主题色 ================= */
function extractTheme(cb) {
  var img = document.getElementById("cover");
  if (!img || !img.naturalWidth) { cb(null); return; }
  try {
    var c = document.createElement("canvas");
    c.width = c.height = 32;
    var ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0, 32, 32);
    var d = ctx.getImageData(0, 0, 32, 32).data;
    var r = 0, g = 0, b = 0, n = 0;
    for (var i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    cb([Math.round(r / n), Math.round(g / n), Math.round(b / n)]);
  } catch (e) { cb(null); }
}
function applyTheme(rgb) {
  var panel = document.getElementById("lrcPanelMain");
  if (!rgb || !panel) return;
  var r = rgb[0], g = rgb[1], b = rgb[2];
  panel.style.background = "linear-gradient(165deg,rgba(" + r + "," + g + "," + b + ",.16) 0%,rgba(" + r + "," + g + "," + b + ",.06) 60%),rgba(255,255,255,.88)";
  panel.style.borderColor = "rgba(" + r + "," + g + "," + b + ",.5)";
  panel.style.boxShadow = "0 6px 24px rgba(" + r + "," + g + "," + b + ",.32)";
  panel.style.setProperty("--theme", "rgb(" + r + "," + g + "," + b + ")");
  panel.style.setProperty("--theme-glow", "rgba(" + r + "," + g + "," + b + ",.55)");
}

/* ================= 歌词（双语） ================= */
function loadLrc(id) {
  var box = document.getElementById("lrcBox");
  box.innerHTML = "";
  var tip = document.createElement("div");
  tip.className = "lrc-line meta";
  tip.textContent = "歌词加载中……";
  box.appendChild(tip);
  fetch(proxyUrl("lyric", id))
    .then(function (r) { return r.text(); })
    .then(function (txt) {
      S.lrc = parseLrc(txt);
      renderLrc();
    })
    .catch(function () {
      S.lrc = [];
      box.innerHTML = "";
      var tip2 = document.createElement("div");
      tip2.className = "lrc-line meta";
      tip2.textContent = "暂无歌词";
      box.appendChild(tip2);
    });
}
function parseLrc(text) {
  var rows = [];
  String(text || "").split(String.fromCharCode(10)).forEach(function (line) {
    line = line.trim();
    if (!line) return;
    var times = [];
    var rest = line;
    while (rest.charAt(0) === "[") {
      var end = rest.indexOf("]");
      if (end < 0) break;
      var tag = rest.slice(1, end);
      var p = tag.indexOf(":");
      if (p <= 0) break;
      var mm = Number(tag.slice(0, p));
      var ss = Number(tag.slice(p + 1).replace(",", "."));
      if (!isFinite(mm) || !isFinite(ss)) break;
      times.push(mm * 60 + ss);
      rest = rest.slice(end + 1);
    }
    var content = rest.trim();
    if (!content) content = "♪";
    if (times.length) {
      times.forEach(function (t) { rows.push({ t: t, c: content }); });
    } else if (content !== "♪") {
      rows.push({ t: -1, c: content });
    }
  });
  rows.sort(function (a, b) { return a.t - b.t; });
  // 翻译合并：同一时间戳（或极近 <0.5s）且内容不同的相邻行 → 原文+翻译 双行
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var cur = rows[i];
    var nxt = rows[i + 1];
    if (nxt && cur.t >= 0 && Math.abs(nxt.t - cur.t) < 0.5 && cur.c !== nxt.c && cur.c !== "♪" && nxt.c !== "♪") {
      out.push({ t: cur.t, c: cur.c, tl: nxt.c });
      i++;
      continue;
    }
    out.push({ t: cur.t, c: cur.c, tl: "" });
  }
  return out;
}
function renderLrc() {
  var box = document.getElementById("lrcBox");
  box.innerHTML = "";
  if (!S.lrc.length) {
    var tip = document.createElement("div");
    tip.className = "lrc-line meta";
    tip.textContent = "暂无歌词";
    box.appendChild(tip);
    return;
  }
  S.lrc.forEach(function (it, i) {
    var d = document.createElement("div");
    d.className = "lrc-line" + (i === S.lrcIdx ? " active" : "");
    var s1 = document.createElement("div");
    s1.className = "lc";
    s1.textContent = it.c || "♪";
    d.appendChild(s1);
    if (it.tl) {
      var s2 = document.createElement("div");
      s2.className = "lt";
      s2.textContent = it.tl;
      d.appendChild(s2);
    }
    d.onclick = function () { if (it.t >= 0) audio.currentTime = it.t; };
    box.appendChild(d);
  });
}
function updateLrc() {
  if (!S.lrc.length) return;
  var t = audio.currentTime;
  var idx = -1;
  for (var i = S.lrc.length - 1; i >= 0; i--) {
    if (S.lrc[i].t >= 0 && S.lrc[i].t <= t) { idx = i; break; }
  }
  if (idx === S.lrcIdx) return;
  S.lrcIdx = idx;
  var box = document.getElementById("lrcBox");
  var lines = box.children;
  for (var j = 0; j < lines.length; j++) {
    lines[j].className = "lrc-line" + (j === idx ? " active" : "");
  }
  if (idx >= 0 && lines[idx]) {
    lines[idx].scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

/* ================= 全屏搜索结果页 ================= */
var lrcOpen = false;
function openList() {
  var o = document.getElementById("lrcOverlay");
  o.classList.remove("hidden");
  void o.offsetWidth; // 强制重排，让入场动画生效
  o.classList.add("show");
  document.getElementById("btnLrc").classList.add("on");
  lrcOpen = true;
}
function closeList() {
  var o = document.getElementById("lrcOverlay");
  o.classList.remove("show");
  document.getElementById("btnLrc").classList.remove("on");
  lrcOpen = false;
  setTimeout(function () { o.classList.add("hidden"); }, 400);
}
function toggleList() {
  if (lrcOpen) closeList(); else openList();
}

/* ================= 进度同步 ================= */
function syncTimes() {
  var d = isFinite(audio.duration) ? audio.duration : 0;
  var cur = fmt(audio.currentTime);
  var pct = d ? String(Math.round(audio.currentTime / d * 1000)) : "0";
  document.getElementById("cur").textContent = cur;
  document.getElementById("dur").textContent = fmt(d);
  var seek = document.getElementById("seek");
  if (!seek.__drag) seek.value = pct;
  var lc = document.getElementById("lrcCur");
  if (lc) {
    lc.textContent = cur;
    document.getElementById("lrcDur").textContent = fmt(d);
    var ls = document.getElementById("lrcSeek");
    if (!ls.__drag) ls.value = pct;
  }
  updateLrc();
}

/* ================= 事件绑定 ================= */
audio.addEventListener("timeupdate", syncTimes);
audio.addEventListener("play", function () { setPlaying(true); });
audio.addEventListener("pause", function () { setPlaying(false); });
audio.addEventListener("ended", function () {
  if (S.mode === 2) { audio.currentTime = 0; audio.play(); return; }
  if (S.idx < S.list.length - 1) { playItem(S.idx + 1); return; }
  if (S.mode === 1) { playItem(0); return; }
  setPlaying(false);
});
audio.addEventListener("error", function () {
  document.getElementById("cur").textContent = "播放失败";
});

var seekEl = document.getElementById("seek");
seekEl.addEventListener("input", function () { seekEl.__drag = true; });
seekEl.addEventListener("change", function () {
  seekEl.__drag = false;
  if (isFinite(audio.duration) && audio.duration) {
    audio.currentTime = Number(seekEl.value) / 1000 * audio.duration;
  }
});
var lrcSeekEl = document.getElementById("lrcSeek");
lrcSeekEl.addEventListener("input", function () { lrcSeekEl.__drag = true; });
lrcSeekEl.addEventListener("change", function () {
  lrcSeekEl.__drag = false;
  if (isFinite(audio.duration) && audio.duration) {
    audio.currentTime = Number(lrcSeekEl.value) / 1000 * audio.duration;
  }
});

var volEl = document.getElementById("vol");
volEl.addEventListener("input", function () { audio.volume = Number(volEl.value) / 100; });
audio.volume = 0.8;

document.getElementById("btnSearch").onclick = search;
document.getElementById("kw").addEventListener("keydown", function (e) {
  if (e.key === "Enter") search();
});
document.getElementById("selServer").addEventListener("change", function () {
  S.server = this.value;
});
document.getElementById("btnPlay").onclick = function () {
  if (!audio.src) { if (S.list.length) playItem(0); return; }
  if (audio.paused) audio.play(); else audio.pause();
};
document.getElementById("btnPrev").onclick = function () {
  if (!S.list.length) return;
  playItem(S.idx > 0 ? S.idx - 1 : S.list.length - 1);
};
document.getElementById("btnNext").onclick = function () {
  if (!S.list.length) return;
  playItem(S.idx < S.list.length - 1 ? S.idx + 1 : 0);
};
document.getElementById("btnMode").onclick = function () {
  S.mode = (S.mode + 1) % 3;
  this.textContent = modeIcons[S.mode];
  this.title = modeNames[S.mode];
};
document.getElementById("btnLrc").onclick = toggleList;
document.getElementById("lrcClose").onclick = closeList;
document.getElementById("lrcPlay").onclick = function () {
  if (!audio.src) { if (S.list.length) playItem(0); return; }
  if (audio.paused) audio.play(); else audio.pause();
};
document.getElementById("lrcPrev").onclick = function () {
  if (!S.list.length) return;
  playItem(S.idx > 0 ? S.idx - 1 : S.list.length - 1);
};
document.getElementById("lrcNext").onclick = function () {
  if (!S.list.length) return;
  playItem(S.idx < S.list.length - 1 ? S.idx + 1 : 0);
};
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape" && lrcOpen) closeList();
});

/* 初始：不自动搜索任何歌曲；桌面端显示空的搜索结果侧栏 */
if (window.matchMedia("(min-width:769px)").matches) openList();
</script>
</body>
</html>
`;

// ============================================================
//  Worker 入口
// ============================================================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response("", { status: 204, headers: CORS });
    }
    const p = url.pathname;
    if (p === "/" || p === "/index.html") {
      return new Response(HTML, {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...CORS },
      });
    }
    if (p === "/api" || p.startsWith("/api/")) return handleApi(url, env);
    if (p === "/stream") return resolveBinary(url, env, "stream");
    if (p === "/cover") return resolveBinary(url, env, "cover");
    if (p === "/lyric") return handleLyric(url, env);
    return new Response("Not Found", { status: 404, headers: CORS });
  },
};