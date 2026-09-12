/**
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
 *   server: netease（上游 api.107211.xyz 目前仅支持网易云）
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
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#101015">
<title>在线音乐</title>
<style>
:root{
  --bg:#101015;
  --panel:#17171d;
  --panel2:#1c1c23;
  --line:rgba(255,255,255,.08);
  --line2:rgba(255,255,255,.14);
  --txt:#e7e7ea;
  --txt2:#9a9aa3;
  --txt3:#62626b;
  --accent:#e6a23c;
  --accent2:#d18f2c;
  --r:10px;
}
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%}
body{
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
  -webkit-font-smoothing:antialiased;
  color:var(--txt);
  background:var(--bg);
  position:fixed;inset:0;width:100%;height:100%;
  display:flex;flex-direction:column;overflow:hidden;
}
button{cursor:pointer;border:none;background:none;color:inherit;font:inherit}
input,select{font:inherit;color:inherit}

/* ── 顶部搜索栏 ── */
.top{
  display:flex;align-items:center;gap:16px;flex-wrap:wrap;
  padding:12px 20px;
  background:rgba(19,19,25,.94);
  border-bottom:1px solid var(--line);
  z-index:50;
}
.brand{font-size:16px;font-weight:600;white-space:nowrap}
.brand b{color:var(--accent);font-weight:600;margin-right:2px}
.search-bar{display:flex;gap:8px;flex:1 1 280px;min-width:280px}
.sbar input{
  flex:1;min-width:120px;
  background:var(--panel2);
  border:1px solid var(--line);
  border-radius:8px;
  padding:8px 12px;
  color:var(--txt);
  outline:none;
  transition:border-color .15s,background .15s;
}
.sbar input::placeholder{color:var(--txt3)}
.sbar input:focus{border-color:var(--accent);background:#202028}
.btn-pill{
  background:var(--accent);color:#1a140a;
  border-radius:8px;padding:8px 18px;
  font-size:14px;font-weight:600;
  transition:background .15s;
}
.btn-pill:hover{background:var(--accent2)}
.btn-pill:active{transform:translateY(1px)}

/* ── 主区 ── */
.main{
  flex:1;display:flex;flex-direction:column;gap:14px;
  padding:14px 20px 88px;overflow:hidden;
}
.lrc-wrap{
  flex:1;display:flex;flex-direction:column;min-height:0;
  background:var(--panel);
  border:1px solid var(--line);
  border-radius:var(--r);
  overflow:hidden;position:relative;
}
.list-head{
  display:flex;justify-content:space-between;align-items:center;gap:10px;
  padding:10px 14px;
  font-size:12px;color:var(--txt2);
  border-bottom:1px solid var(--line);
}
.list-head .label{font-size:13px;font-weight:600;color:var(--txt)}
#lrcNow{font-size:12px;color:var(--txt3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}

/* ── 歌词 ── */
.lrc-box{flex:1;overflow-y:auto;text-align:center;padding:26px 12px;scrollbar-width:none}
.lrc-box::-webkit-scrollbar{display:none}
.lrc-line{
  padding:9px 6px;text-align:center;font-size:17px;line-height:1.6;
  color:var(--txt3);cursor:pointer;
  transition:color .25s;
}
.lrc-line:hover{color:var(--txt2)}
.lrc-line.active{color:var(--txt);font-size:19px;font-weight:600}
.lrc-line.meta{color:var(--txt3);font-size:13px;cursor:default}
.lrc-line .lc{word-break:break-word}
.lrc-line .lt{font-size:.72em;line-height:1.5;margin-top:2px;color:var(--txt2);opacity:.62}

/* ── 底部播放条 ── */
.player{
  position:fixed;left:0;right:0;bottom:0;
  display:flex;align-items:center;gap:14px;flex-wrap:wrap;
  padding:10px 20px;padding-bottom:calc(10px + env(safe-area-inset-bottom));
  background:rgba(17,17,22,.96);
  border-top:1px solid var(--line);
  z-index:100;
}
.player img{
  width:52px;height:52px;border-radius:8px;object-fit:cover;flex:none;
  background:var(--panel2);border:1px solid var(--line);
}
.p-meta{width:170px;min-width:0}
.p-meta .t{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.p-meta .a{font-size:12px;color:var(--txt2);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.p-ctrl{display:flex;align-items:center;gap:2px}
.p-ctrl button{
  width:38px;height:38px;border-radius:50%;
  display:flex;align-items:center;justify-content:center;color:var(--txt2);
  transition:background .15s,color .15s;
}
.p-ctrl button:hover{background:rgba(255,255,255,.07);color:var(--txt)}
#btnPlay{width:46px;height:46px;background:var(--accent);color:#1a140a}
#btnPlay:hover{background:var(--accent2);color:#1a140a}
.p-prog{flex:1;display:flex;align-items:center;gap:8px;min-width:120px}
.p-prog span{font-size:12px;color:var(--txt2);font-variant-numeric:tabular-nums;min-width:36px;text-align:center}
input[type=range]{
  -webkit-appearance:none;appearance:none;height:4px;border-radius:2px;
  background:rgba(255,255,255,.13);outline:none;cursor:pointer;
}
input[type=range]::-webkit-slider-thumb{
  -webkit-appearance:none;width:12px;height:12px;border-radius:50%;
  background:var(--accent);border:2px solid var(--bg);opacity:0;
  transition:opacity .15s;
}
input[type=range]::-moz-range-thumb{width:10px;height:10px;border:2px solid var(--bg);border-radius:50%;background:var(--accent);opacity:0;transition:opacity .15s}
input[type=range]:hover::-webkit-slider-thumb,input[type=range]:focus::-webkit-slider-thumb{opacity:1}
input[type=range]:hover::-moz-range-thumb,input[type=range]:focus::-moz-range-thumb{opacity:1}
#seek{flex:1}
#vol{width:90px}
.p-side{display:flex;align-items:center;gap:6px}
.vol-ic{display:flex;color:var(--txt3)}
.p-side button{
  height:34px;padding:0 10px;border-radius:7px;
  font-size:12px;color:var(--txt2);
  display:flex;align-items:center;justify-content:center;
  transition:background .15s,color .15s;
}
.p-side button:hover{background:rgba(255,255,255,.07);color:var(--txt)}
.p-side button.on{background:rgba(230,162,60,.15);color:var(--accent)}

/* ── 搜索结果覆盖层（移动端全屏 / 桌面端侧栏） ── */
.lrc-overlay{
  position:fixed;inset:0;z-index:200;
  display:flex;flex-direction:column;
  opacity:0;transform:translateY(24px);pointer-events:none;
  transition:opacity .25s ease,transform .25s ease;
}
.lrc-overlay.hidden{display:none}
.lrc-overlay.show{opacity:1;transform:none;pointer-events:auto}
.lrc-bg{
  position:absolute;inset:-40px;background-size:cover;background-position:center;
  filter:blur(46px) saturate(1.3);transform:scale(1.15);opacity:.45;
}
.lrc-scrim{position:absolute;inset:0;background:linear-gradient(180deg,rgba(15,15,20,.86),rgba(15,15,20,.95))}
.lrc-top{
  position:relative;z-index:2;display:flex;align-items:center;gap:12px;
  padding:14px 16px;padding-top:calc(14px + env(safe-area-inset-top));
}
.lrc-close{
  width:34px;height:34px;border-radius:8px;flex:none;
  background:rgba(255,255,255,.06);border:1px solid var(--line);
  display:flex;align-items:center;justify-content:center;color:var(--txt2);
  transition:background .15s,color .15s;
}
.lrc-close:hover{background:rgba(255,255,255,.1);color:var(--txt)}
.lrc-meta{min-width:0}
.lrc-meta .t{font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lrc-meta .a{font-size:12px;color:var(--txt2);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ov-list-wrap{
  position:relative;z-index:2;flex:1;min-height:0;
  display:flex;flex-direction:column;
  margin:6px 10px 10px;
  background:var(--panel);border:1px solid var(--line);border-radius:var(--r);
  overflow:hidden;
}
#list{flex:1;overflow-y:auto;padding:6px;list-style:none}
#list::-webkit-scrollbar{width:8px}
#list::-webkit-scrollbar-thumb{background:rgba(255,255,255,.15);border-radius:4px}
#list li{
  display:flex;align-items:center;gap:12px;
  padding:9px 10px;border-radius:8px;
  border-left:2px solid transparent;cursor:pointer;
  transition:background .15s;
}
#list li:hover{background:rgba(255,255,255,.05)}
#list li.active{background:rgba(230,162,60,.1);border-left-color:var(--accent)}
#list li .num{width:22px;flex:none;text-align:center;font-size:11px;color:var(--txt3);font-variant-numeric:tabular-nums}
#list li.active .num{color:var(--accent)}
#list li .nm{flex:1;min-width:0}
#list li .t{font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#list li .a{font-size:12px;color:var(--txt2);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#list li .play-badge{display:none;flex:none;color:var(--accent)}
#list li.active .play-badge{display:block}
#list .empty{padding:48px 16px;text-align:center;color:var(--txt3);font-size:13px}

/* ── 自适应 ── */
@media (max-width:768px){
  .top{padding:10px 12px;gap:10px}
  .brand{font-size:15px}
  .main{padding:12px 12px 96px}
  .player{gap:10px;padding:8px 12px}
  .player img{width:44px;height:44px}
  .p-meta{width:110px}
  .p-prog{min-width:0}
  #vol{width:64px}
  .lrc-box{padding:20px 8px}
  .lrc-line{font-size:16px}
  .lrc-line.active{font-size:18px}
}
@media (max-width:560px){
  .search-bar{flex:1 1 100%;min-width:0}
  .sbar input{min-width:0}
  .btn-pill{padding:8px 16px}
  .player{row-gap:4px}
  .player img{width:42px;height:42px}
  .p-meta{flex:1;width:auto;min-width:0}
  .p-side #vol{display:none}
  .p-prog{flex:1 1 100%;order:9;min-width:0}
  .lrc-box{padding:16px 6px}
  .lrc-line{font-size:15px}
  .lrc-line.active{font-size:17px}
}
@media (max-width:380px){
  .brand{font-size:14px}
  .p-meta{max-width:80px}
}
@media (max-height:540px){
  .lrc-box{padding:10px 8px}
  .lrc-line{font-size:14px}
  .lrc-line.active{font-size:16px}
}
/* 桌面：搜索结果变侧栏 */
@media (min-width:769px){
  .main{flex-direction:row;align-items:stretch}
  .lrc-wrap{flex:1;min-width:0}
  .lrc-overlay{
    position:relative;inset:auto;z-index:10;flex:0 0 300px;min-width:300px;max-width:340px;
    opacity:1;transform:none;pointer-events:auto;display:flex;
    background:var(--panel);border:1px solid var(--line);border-radius:var(--r);
    overflow:hidden;transition:none;
  }
  .lrc-overlay.hidden{display:none}
  .lrc-bg,.lrc-scrim{display:none}
  .lrc-close{display:none}
  .lrc-top{padding:12px 14px}
  .ov-list-wrap{margin:8px}
}
@media (min-width:1200px){
  .main{max-width:1280px;margin:0 auto;width:100%}
  .lrc-line{font-size:18px}
  .lrc-line.active{font-size:21px}
}
</style>
</head>
<body>

<header class="top">
  <h1 class="brand"><b>♪</b>在线音乐</h1>
  <div class="search-bar sbar">
    <input id="kw" type="text" placeholder="搜索歌曲 / 歌手" autocomplete="off">
    <button class="btn-pill" id="btnSearch">搜索</button>
  </div>
</header>

<main class="main">
  <section class="lrc-wrap" id="lrcPanelMain">
    <div class="list-head"><span class="label">歌词</span><span id="lrcNow">选择歌曲后自动加载</span></div>
    <div class="lrc-box" id="lrcBox"><div class="lrc-line meta">搜索并播放一首歌，歌词会显示在这里</div></div>
  </section>

  <aside class="lrc-overlay hidden" id="lrcOverlay">
    <div class="lrc-bg" id="lrcBg"></div>
    <div class="lrc-scrim"></div>
    <div class="lrc-top">
      <button class="lrc-close" id="lrcClose" title="收起" aria-label="收起"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></button>
      <div class="lrc-meta">
        <div class="t">搜索结果</div>
        <div class="a" id="ovStat">输入关键词搜索</div>
      </div>
    </div>
    <div class="ov-list-wrap">
      <div class="list-head"><span class="label">歌曲列表</span><span id="stat"></span></div>
      <ul id="list"><li class="empty">输入关键词，开始搜索</li></ul>
    </div>
  </aside>
</main>

<footer class="player">
  <img id="cover" alt="封面" src="https://t.alcy.cc/tx">
  <div class="p-meta">
    <div class="t" id="pTitle">未在播放</div>
    <div class="a" id="pAuthor"></div>
  </div>
  <div class="p-ctrl">
    <button id="btnPrev" title="上一首"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 5h2v14H6zM20 5l-10 7 10 7z"/></svg></button>
    <button id="btnPlay" title="播放"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></button>
    <button id="btnNext" title="下一首"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M16 5h2v14h-2zM4 5l10 7-10 7z"/></svg></button>
  </div>
  <div class="p-prog">
    <span id="cur">00:00</span>
    <input id="seek" type="range" min="0" max="1000" value="0">
    <span id="dur">00:00</span>
  </div>
  <div class="p-side">
    <span class="vol-ic"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg></span>
    <input id="vol" type="range" min="0" max="100" value="80" title="音量">
    <button id="btnMode" title="顺序播放">顺序</button>
    <button id="btnLrc" title="搜索结果"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg></button>
  </div>
</footer>

<audio id="audio" preload="metadata"></audio>

<script>
/* ================= 全局状态 ================= */
var S = { server: "netease", list: [], idx: -1, mode: 0, lrc: [], lrcIdx: -1 };
var audio = document.getElementById("audio");
var modeNames = ["顺序", "循环", "单曲"];
var modeTitles = ["顺序播放", "列表循环", "单曲循环"];
var ICON_PLAY = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
var ICON_PAUSE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';
var ICON_BADGE = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';

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
function paintRange(el) {
  var min = parseFloat(el.min) || 0, max = parseFloat(el.max) || 100, v = parseFloat(el.value) || 0;
  var pct = max > min ? (v - min) / (max - min) * 100 : 0;
  el.style.background = "linear-gradient(90deg,var(--accent) " + pct + "%,rgba(255,255,255,.13) " + pct + "%)";
}

/* ================= 搜索 ================= */
function search() {
  var kw = document.getElementById("kw").value.trim();
  if (!kw) return;
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
    li.textContent = "没有结果，换个关键词试试";
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
    badge.innerHTML = ICON_BADGE;
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
  coverEl.onerror = function () { coverEl.src = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="112" height="112"><rect width="112" height="112" rx="20" fill="#18181f"/><rect x="1" y="1" width="110" height="110" rx="19" fill="none" stroke="#2a2a33" stroke-width="2"/><text x="56" y="68" font-size="34" text-anchor="middle" fill="#55555f">♪</text></svg>'); };
  audio.play().then(function () { setPlaying(true); }).catch(function () {});
  document.getElementById("lrcNow").textContent = songTitle(it) + " - " + songAuthor(it);
  document.getElementById("lrcBg").style.backgroundImage = "url('" + proxyUrl("cover", id) + "')";
  loadLrc(id);
}
function setPlaying(on) {
  document.getElementById("btnPlay").innerHTML = on ? ICON_PAUSE : ICON_PLAY;
}

/* ================= 封面主题色（仅轻微染色面板） ================= */
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
  panel.style.background = "linear-gradient(180deg,rgba(" + r + "," + g + "," + b + ",.14),rgba(" + r + "," + g + "," + b + ",.03) 45%),var(--panel)";
  panel.style.borderColor = "rgba(" + r + "," + g + "," + b + ",.35)";
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

/* ================= 搜索结果页 ================= */
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
  setTimeout(function () { o.classList.add("hidden"); }, 300);
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
  if (!seek.__drag) { seek.value = pct; paintRange(seek); }
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
seekEl.addEventListener("input", function () { seekEl.__drag = true; paintRange(seekEl); });
seekEl.addEventListener("change", function () {
  seekEl.__drag = false;
  if (isFinite(audio.duration) && audio.duration) {
    audio.currentTime = Number(seekEl.value) / 1000 * audio.duration;
  }
  paintRange(seekEl);
});
var volEl = document.getElementById("vol");
volEl.addEventListener("input", function () { audio.volume = Number(volEl.value) / 100; paintRange(volEl); });
audio.volume = 0.8;
paintRange(seekEl);
paintRange(volEl);

document.getElementById("btnSearch").onclick = search;
document.getElementById("kw").addEventListener("keydown", function (e) {
  if (e.key === "Enter") search();
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
  this.textContent = modeNames[S.mode];
  this.title = modeTitles[S.mode];
};
document.getElementById("btnLrc").onclick = toggleList;
document.getElementById("lrcClose").onclick = closeList;
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape" && lrcOpen) closeList();
});

/* 初始：桌面端显示空的搜索结果侧栏 */
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
