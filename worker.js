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
//  风格：黑白工具页，无卡片无阴影无渐变，尽量朴素
// ============================================================

const HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="theme-color" content="#ffffff">
<meta name="format-detection" content="telephone=no">
<title>music player</title>
<style>
:root{
  --bg:#ffffff;
  --fg:#17181a;
  --muted:#666a70;
  --faint:#9aa0a8;
  --line:#e3e4e6;
  --line-strong:#c9ccd1;
  --ink:#17181a;
  --theme:#17181a; /* 封面主色，由 JS 更新 */
  --mono:ui-monospace,"SF Mono","Cascadia Mono","JetBrains Mono",Consolas,monospace;
}
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%}
body{
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
  -webkit-font-smoothing:antialiased;
  background:var(--bg);color:var(--fg);
  position:fixed;inset:0;width:100%;height:100%;
  display:flex;flex-direction:column;overflow:hidden;
}
button{cursor:pointer;border:none;background:none;color:inherit;font:inherit}
input{font:inherit;color:inherit}
::-webkit-scrollbar{width:9px;height:9px}
::-webkit-scrollbar-thumb{background:#d5d7db;border:3px solid var(--bg);border-radius:6px}
::-webkit-scrollbar-track{background:transparent}

/* ── 顶部工具条 ── */
.toolbar{
  display:flex;align-items:center;gap:14px;
  padding:9px 16px;
  border-bottom:1px solid var(--line);
  background:var(--bg);
}
.brand{font-size:14px;font-weight:700;white-space:nowrap;letter-spacing:.01em}
.brand .dot{color:var(--faint);font-weight:400}
.search{flex:1;display:flex;gap:6px;min-width:0}
.search input{
  flex:1;min-width:80px;
  border:1px solid var(--line-strong);border-radius:4px;
  background:var(--bg);color:var(--fg);
  padding:6px 10px;font-size:14px;
}
.search input::placeholder{color:var(--faint)}
.search input:focus{outline:none;border-color:var(--fg)}
.search button{
  border:1px solid var(--line-strong);border-radius:4px;
  background:var(--bg);color:var(--fg);
  padding:6px 16px;font-size:14px;
}
.search button:hover{background:var(--ink);color:#fff;border-color:var(--ink)}

/* ── 主区 ── */
.stage{flex:1;display:flex;min-height:0;overflow:hidden}

/* 歌词区：纯文本，背景随封面主题色 */
.lyrics{
  flex:1;min-width:0;display:flex;flex-direction:column;
  background:var(--bg);
  transition:background-color .7s ease,box-shadow .7s ease;
}
.lyrics-head{
  padding:10px 18px 8px;
  font-size:12px;color:var(--faint);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  font-family:var(--mono);
}
.lrc-box{flex:1;overflow-y:auto;padding:6px 18px 20px;text-align:center}
.lrc-line{
  display:block;width:100%;
  padding:5px 0;
  text-align:center;font-size:16px;line-height:1.5;
  color:var(--faint);cursor:pointer;
  transition:color .15s,transform .3s;
}
.lrc-line:hover{color:var(--fg)}
.lrc-line.active{color:var(--fg);font-weight:600;font-size:20px;transform:scale(1.08)}
.lrc-line.meta{color:var(--faint);font-size:13px;cursor:default}
.lrc-line .lc{word-break:break-word}
.lrc-line .lt{font-size:.74em;line-height:1.5;margin-top:1px;color:var(--muted)}
/* 音频可视化条：歌词栏底部 */
.lyrics .viz{width:100%;height:16px;display:block;flex:none}

/* ── 搜索结果：移动端全屏覆盖 / 桌面端右侧栏 ── */
.results{
  position:fixed;inset:0;z-index:60;
  display:flex;flex-direction:column;
  background:var(--bg);
  opacity:0;transform:translateY(10px);pointer-events:none;
  transition:opacity .18s ease,transform .18s ease;
}
.results.hidden{display:none}
.results.show{opacity:1;transform:none;pointer-events:auto}
.lrc-bg,.lrc-scrim{display:none}
.results-head{
  display:flex;align-items:center;gap:10px;
  padding:12px 16px;padding-top:calc(12px + env(safe-area-inset-top));
  border-bottom:1px solid var(--line);
}
.results-title{font-size:14px;font-weight:700;white-space:nowrap}
.count{font-family:var(--mono);font-size:12px;color:var(--faint);white-space:nowrap}
.sub{margin-left:auto;font-size:12px;color:var(--faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.close{
  width:32px;height:32px;flex:none;
  border:1px solid var(--line-strong);border-radius:4px;
  background:var(--bg);color:var(--fg);font-size:18px;line-height:1;
}
.close:hover{background:#f2f3f5}
.song-list{flex:1;overflow-y:auto;list-style:none;padding:4px 0 12px}
.song-list li{
  display:flex;align-items:center;gap:10px;
  padding:8px 18px 8px 14px;
  border-left:2px solid transparent;
  cursor:pointer;
}
.song-list li:hover{background:#f4f5f6}
.song-list li.active{background:#f4f5f6;border-left-color:var(--fg)}
.song-list .num{
  width:28px;flex:none;
  font-family:var(--mono);font-size:12px;color:var(--faint);
  text-align:center;
}
.song-list li.active .num{color:var(--fg);font-weight:700}
.song-list .nm{flex:1;min-width:0}
.song-list .t{font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.song-list .a{font-size:12px;color:var(--muted);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.song-list .play-badge{display:none;flex:none;color:var(--fg)}
.song-list li.active .play-badge{display:block}
.song-list .empty{padding:40px 16px;text-align:center;font-size:13px;color:var(--faint);cursor:default}

/* ── 底部播放条：状态栏式 ── */
.player{
  display:flex;align-items:center;gap:14px;
  padding:8px 16px;
  padding-bottom:calc(8px + env(safe-area-inset-bottom));
  background:var(--bg);
  border-top:1px solid var(--line);
}
.player .cover{
  width:44px;height:44px;flex:none;
  border:1px solid var(--line-strong);border-radius:4px;
  background:var(--bg);object-fit:cover;
}
.now{width:190px;flex:none;min-width:0}
.now .t{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.now .a{font-size:12px;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ctrl{display:flex;align-items:center;gap:2px}
.ctrl button{
  width:36px;height:36px;
  display:flex;align-items:center;justify-content:center;
  border:1px solid transparent;border-radius:4px;
  color:var(--fg);font-size:15px;
}
.ctrl button:hover{border-color:var(--line-strong);background:#f2f3f5}
#btnPlay{width:40px;height:40px;background:var(--ink);color:#fff}
#btnPlay:hover{border-color:var(--ink);background:var(--ink)}
.prog{flex:1;display:flex;align-items:center;gap:10px;min-width:120px}
.time{
  font-family:var(--mono);font-size:12px;color:var(--muted);
  min-width:30px;text-align:center;font-variant-numeric:tabular-nums;
}
input[type=range]{
  -webkit-appearance:none;appearance:none;
  height:3px;border-radius:3px;
  background:#e3e4e6;outline:none;cursor:pointer;
}
input[type=range]::-webkit-slider-thumb{
  -webkit-appearance:none;width:11px;height:11px;border-radius:50%;
  background:var(--theme);border:2px solid var(--bg);
}
input[type=range]::-moz-range-thumb{
  width:8px;height:8px;border:2px solid var(--bg);border-radius:50%;
  background:var(--theme);
}
#seek{flex:1}
#vol{width:70px}
.extras{display:flex;align-items:center;gap:6px}
.vol-label{font-size:12px;color:var(--faint);font-family:var(--mono)}
.extras button{
  border:1px solid var(--line-strong);border-radius:4px;
  background:var(--bg);color:var(--fg);
  padding:5px 10px;font-size:12px;
}
.extras button:hover{background:#f2f3f5}
.extras button.on{background:var(--ink);color:#fff;border-color:var(--ink)}

/* ── 自适应 ── */
@media (max-width:768px){
  .toolbar{gap:10px;padding:8px 12px}
  .player{gap:10px;padding:7px 12px}
  .player .cover{width:40px;height:40px}
  .now{width:130px}
  #vol{width:56px}
  .lyrics-head{padding:8px 14px 6px}
  .lrc-box{padding:4px 12px 16px}
  .lrc-line{font-size:15px}
  .lrc-line.active{font-size:18px}
}
@media (max-width:560px){
  .search{flex:1 1 100%}
  .toolbar{flex-wrap:wrap;padding-bottom:8px}
  .brand{flex:1 1 100%;font-size:13px}
  .player{flex-wrap:wrap;row-gap:4px}
  .player .cover{width:38px;height:38px}
  .now{flex:1;width:auto;min-width:0}
  .ctrl{gap:0}
  .prog{order:9;flex:1 1 100%;min-width:0}
  .vol-label{display:none}
  #vol{display:none}
.lrc-box{padding:2px 10px 14px}
  .lrc-line{font-size:15px}
  .lrc-line.active{font-size:18px}
}
@media (max-width:380px){
  .now .a{display:none}
}
@media (max-height:520px){
  .lrc-box{padding-top:0}
  .lrc-line{font-size:14px;padding:3px 0}
  .lrc-line.active{font-size:17px}
}
/* 桌面：结果区变右侧栏 */
@media (min-width:769px){
  .results{
    position:relative;inset:auto;z-index:10;
    flex:0 0 300px;min-width:300px;max-width:340px;
    border-left:1px solid var(--line);
    opacity:1;transform:none;pointer-events:auto;
    display:flex;transition:none;
  }
  .results.hidden{display:none}
  .lrc-close,
  .results-head .sub{display:none}
  .results-head{padding-top:12px}
  .song-list{padding-top:6px}
}
</style>
</head>
<body>

<header class="toolbar">
  <span class="brand">music<span class="dot">·</span>player</span>
  <div class="search">
    <input id="kw" type="search" placeholder="歌名 / 歌手 / 专辑" autocomplete="off" enterkeyhint="search">
    <button id="btnSearch">搜索</button>
  </div>
</header>

<main class="stage">
  <section class="lyrics" id="lrcPanelMain">
    <div class="lyrics-head" id="lrcNow">-- no song --</div>
    <div class="lrc-box" id="lrcBox"><div class="lrc-line meta">在上方搜索并播放一首歌</div></div>
    <canvas id="viz" class="viz"></canvas>
  </section>

  <aside class="results hidden" id="lrcOverlay">
    <div class="lrc-bg" id="lrcBg"></div>
    <div class="lrc-scrim"></div>
    <div class="results-head">
      <span class="results-title">搜索结果</span>
      <span id="stat" class="count"></span>
      <span id="ovStat" class="sub"></span>
      <button class="close" id="lrcClose" title="收起" aria-label="收起">×</button>
    </div>
    <ul id="list" class="song-list"></ul>
  </aside>
</main>

<footer class="player">
  <img id="cover" class="cover" alt="cover" src="https://t.alcy.cc/tx">
  <div class="now">
    <div class="t" id="pTitle">-- --</div>
    <div class="a" id="pAuthor"></div>
  </div>
  <div class="ctrl">
    <button id="btnPrev" title="上一首">«</button>
    <button id="btnPlay" title="播放/暂停"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6 4l14 8-14 8z"/></svg></button>
    <button id="btnNext" title="下一首">»</button>
  </div>
  <div class="prog">
    <span class="time" id="cur">0:00</span>
    <input id="seek" type="range" min="0" max="1000" value="0">
    <span class="time" id="dur">0:00</span>
  </div>
  <div class="extras">
    <span class="vol-label">vol</span>
    <input id="vol" type="range" min="0" max="100" value="80" title="音量">
    <button id="btnMode" title="顺序播放">顺序</button>
    <button id="btnLrc" title="搜索结果">列表</button>
  </div>
</footer>

<audio id="audio" preload="metadata" crossorigin="anonymous"></audio>

<script>
/* ================= 状态 ================= */
var S = { server: "netease", list: [], idx: -1, mode: 0, lrc: [], lrcIdx: -1 };
var audio = document.getElementById("audio");
var modeNames = ["顺序", "循环", "单曲"];
var modeTitles = ["顺序播放", "列表循环", "单曲循环"];
var ICON_PLAY = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6 4l14 8-14 8z"/></svg>';
var ICON_PAUSE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>';
var ICON_BADGE = '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M6 4l14 8-14 8z"/></svg>';
var actx = null, analyser = null, freqData = null, vizReady = false;
var themeRGB = [23, 24, 26]; // 封面主色，默认黑，由 applyTheme 更新

/* ================= 工具 ================= */
function apiUrl(type, id) {
  return "/api?server=" + encodeURIComponent(S.server) + "&type=" + encodeURIComponent(type) + "&id=" + encodeURIComponent(id);
}
function proxyUrl(kind, id) {
  return "/" + kind + "?server=" + encodeURIComponent(S.server) + "&id=" + encodeURIComponent(id);
}
function fmt(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  var m = Math.floor(sec / 60), s = sec % 60;
  return m + ":" + (s < 10 ? "0" : "") + s;
}
function songTitle(it) { return it.title || it.name || "未知歌曲"; }
function songAuthor(it) {
  return Array.isArray(it.author) ? it.author.join(" / ") : (it.author || it.artist || "");
}
function paintRange(el) {
  var min = parseFloat(el.min) || 0, max = parseFloat(el.max) || 100, v = parseFloat(el.value) || 0;
  var pct = max > min ? (v - min) / (max - min) * 100 : 0;
  el.style.background = "linear-gradient(90deg,var(--theme) " + pct + "%,#e3e4e6 " + pct + "%)";
}

/* ================= 音频可视化条（WebAudio 频谱） ================= */
function initViz() {
  if (vizReady || !audio) return;
  var AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try {
    actx = new AC();
    var src = actx.createMediaElementSource(audio);
    analyser = actx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.82;
    freqData = new Uint8Array(analyser.frequencyBinCount);
    src.connect(analyser);
    analyser.connect(actx.destination);
    vizReady = true;
  } catch (e) { actx = null; }
}
function kickViz() {
  initViz();
  if (actx && actx.state === "suspended") actx.resume();
}
function vizLoop() {
  var c = document.getElementById("viz");
  if (c && analyser && freqData) {
    var w = c.clientWidth, h = c.clientHeight;
    if (w > 0 && h > 0) {
      if (c.width !== w) c.width = w;
      if (c.height !== h) c.height = h;
      var g = c.getContext("2d");
      analyser.getByteFrequencyData(freqData);
      g.clearRect(0, 0, w, h);
      var n = 96;
      var step = w / n;
      var bw = Math.max(1, step - 1);
      g.fillStyle = "rgba(" + themeRGB[0] + "," + themeRGB[1] + "," + themeRGB[2] + ",.8)";
      for (var i = 0; i < n; i++) {
        var bh = Math.max(2, (freqData[i] / 255) * (h - 2));
        g.fillRect(i * step + (step - bw) / 2, h - bh, bw, bh);
      }
    }
  }
  requestAnimationFrame(vizLoop);
}

/* ================= 搜索 ================= */
function search() {
  var kw = document.getElementById("kw").value.trim();
  if (!kw) return;
  document.getElementById("stat").textContent = "…";
  fetch(apiUrl("search", kw))
    .then(function (r) { return r.json(); })
    .then(function (data) {
      S.list = Array.isArray(data) ? data : (data && data.data) || [];
      S.idx = -1;
      document.getElementById("stat").textContent = S.list.length + " 首";
      document.getElementById("ovStat").textContent = S.list.length > 0 ? S.list.length + " results" : "no result";
      renderList();
      openList();
    })
    .catch(function (e) {
      var msg = (e && e.message) ? e.message : String(e);
      document.getElementById("stat").textContent = "err";
      document.getElementById("ovStat").textContent = "request failed";
      var ul = document.getElementById("list");
      ul.innerHTML = "";
      var li = document.createElement("li");
      li.className = "empty";
      li.textContent = "请求失败：" + msg;
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
    li.textContent = "没有结果";
    ul.appendChild(li);
    return;
  }
  S.list.forEach(function (it, i) {
    var li = document.createElement("li");
    if (i === S.idx) li.className = "active";
    var num = document.createElement("span");
    num.className = "num";
    num.textContent = String(i + 1);
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
  coverEl.onerror = function () { coverEl.src = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="112" height="112"><rect width="112" height="112" fill="#eceded"/><rect x="1" y="1" width="110" height="110" fill="none" stroke="#c9ccd1" stroke-width="2"/><text x="56" y="70" font-size="36" text-anchor="middle" fill="#9aa0a8">♪</text></svg>'); };
  kickViz();
  audio.play().then(function () { setPlaying(true); }).catch(function () {});
  document.getElementById("lrcNow").textContent = songTitle(it) + " - " + songAuthor(it);
  document.getElementById("lrcBg").style.backgroundImage = "url('" + proxyUrl("cover", id) + "')";
  loadLrc(id);
}
function setPlaying(on) {
  document.getElementById("btnPlay").innerHTML = on ? ICON_PAUSE : ICON_PLAY;
}

/* ================= 封面主题色：歌词栏背景染色 ================= */
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
  themeRGB = rgb;
  document.documentElement.style.setProperty("--theme", "rgb(" + r + "," + g + "," + b + ")");
  // 主色向白色混合 78%，得到明显但不刺眼的歌词栏底色；background-color 可平滑过渡
  var tint = function (v) { return Math.round(v + (255 - v) * 0.78); };
  panel.style.backgroundColor = "rgb(" + tint(r) + "," + tint(g) + "," + tint(b) + ")";
  panel.style.boxShadow = "inset 0 2px 0 rgba(" + r + "," + g + "," + b + ",.55)";
}

/* ================= 歌词（双语） ================= */
function loadLrc(id) {
  var box = document.getElementById("lrcBox");
  box.innerHTML = "";
  var tip = document.createElement("div");
  tip.className = "lrc-line meta";
  tip.textContent = "歌词加载中…";
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
      tip2.textContent = "无歌词";
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
    tip.textContent = "无歌词";
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
  updateLrc(); // 渲染完立即定位当前行到中间
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

/* ================= 结果区开关 ================= */
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
  setTimeout(function () { o.classList.add("hidden"); }, 200);
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

/* ================= 事件 ================= */
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
  document.getElementById("cur").textContent = "err";
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
vizLoop();

document.getElementById("btnSearch").onclick = search;
document.getElementById("kw").addEventListener("keydown", function (e) {
  if (e.key === "Enter") search();
});
document.getElementById("btnPlay").onclick = function () {
  kickViz();
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

/* 初始：桌面端显示空结果侧栏 */
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
