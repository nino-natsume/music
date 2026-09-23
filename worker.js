/* =========================================================
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
var HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#e8590c">
<meta name="format-detection" content="telephone=no">
<title>云音乐 · STATION 107211</title>
<style>
:root{
  --paper:#f6f3ec;
  --card:#fffdf8;
  --ink:#201c15;
  --ink2:#5f594c;
  --ink3:#99917c;
  --line:#e6dfd0;
  --line2:#cfc4ad;
  --acc:#e8590c;
  --acc-d:#cf4a06;
  --acc-l:#fdeee0;
  --player-h:92px;
  --sh:0 1px 2px rgba(80,62,35,.08),0 4px 10px rgba(80,62,35,.05);
  --sh-md:0 2px 6px rgba(80,62,35,.12),0 10px 24px rgba(80,62,35,.10);
  --r:16px;
  --sans:"HarmonyOS Sans SC","MiSans","Noto Sans SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif;
  --serif:"Songti SC","Noto Serif SC","Source Han Serif SC","STSong",Georgia,serif;
  --mono:"SFMono-Regular","JetBrains Mono",ui-monospace,"Cascadia Mono",Consolas,monospace;
  --dot:rgba(60,48,28,.05);
}
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{height:100%}
body{
  font-family:var(--sans);
  background-color:var(--paper);
  background-image:radial-gradient(var(--dot) 1px,transparent 1.2px);
  background-size:24px 24px;
  color:var(--ink);
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;
}
button{font:inherit;cursor:pointer;border:none;background:none;color:inherit}
input{font:inherit;color:inherit}
img{display:block}
::-webkit-scrollbar{width:10px;height:10px}
::-webkit-scrollbar-thumb{background:#c6ccd6;border:3px solid var(--paper);border-radius:999px}
::-webkit-scrollbar-track{background:transparent}

/* ================= 顶部导航 ================= */
.nav{
  position:sticky;top:0;z-index:50;
  display:flex;align-items:center;gap:10px;
  padding:0 max(16px,env(safe-area-inset-left)) 0 max(16px,env(safe-area-inset-left));
  height:58px;background:rgba(255,253,248,.88);
  backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
  border-bottom:1px solid var(--line);
}
.brand{display:flex;align-items:center;gap:9px;font-weight:700;cursor:pointer;white-space:nowrap}
.brand .logo{width:28px;height:28px;flex:none;display:flex;align-items:center;justify-content:center;color:#fff;
  background:var(--acc);border-radius:50%;box-shadow:0 2px 6px rgba(232,89,12,.4)}
.brand .logo svg{width:15px;height:15px}
.brand .nm{font-family:var(--serif);font-size:18px;letter-spacing:.04em}
.brand .st{font-family:var(--mono);font-size:10px;color:var(--ink3);letter-spacing:.08em;align-self:flex-end;margin-bottom:3px}
.nav-right{margin-left:auto;display:flex;align-items:center;gap:4px}
.icon-btn{
  width:38px;height:38px;border:none;border-radius:999px;
  display:flex;align-items:center;justify-content:center;color:var(--ink2);position:relative;overflow:hidden;
  transition:background .15s,color .15s,box-shadow .18s;
}
.icon-btn:hover{color:var(--acc);background:var(--acc-l)}
.icon-btn:active{transform:scale(.94)}
.icon-btn svg{width:20px;height:20px}
.login-btn{
  height:38px;padding:0 16px;border-radius:999px;font-size:14px;font-weight:600;color:#fff;
  background:var(--acc);position:relative;overflow:hidden;
  display:flex;align-items:center;gap:7px;transition:background .15s,box-shadow .2s,transform .1s;
  max-width:150px;border:none;box-shadow:0 2px 8px rgba(232,89,12,.35);
}
.login-btn:active{transform:translateY(1px) scale(.99)}
.login-btn:hover{background:var(--acc-d);box-shadow:var(--sh-md)}
.login-btn.user{background:var(--card);color:var(--ink);border:1px solid var(--line2);box-shadow:none}
.login-btn.user:hover{background:var(--paper)}
.login-btn .av{width:26px;height:26px;border-radius:50%;overflow:hidden;flex:none;display:flex;align-items:center;justify-content:center}
.login-btn .av img{width:100%;height:100%;object-fit:cover}
.login-btn .av.fb{background:var(--acc);color:#fff;font-family:var(--sans);font-size:13px}
.login-btn .nm{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13px}

/* ================= 搜索条（默认隐藏） ================= */
.search-bar{
  position:sticky;top:58px;z-index:49;
  display:none;align-items:center;gap:8px;padding:10px 16px;
  background:var(--card);border-bottom:1px solid var(--line);
}
.search-bar.open{display:flex;animation:dropIn .18s ease}
@keyframes dropIn{from{opacity:0;transform:translateY(-5px)}to{opacity:1;transform:none}}
.search-bar .box{
  flex:1;display:flex;align-items:center;gap:8px;height:44px;padding:0 6px 0 14px;
  border-radius:999px;background:var(--paper);border:1px solid transparent;
  transition:border-color .15s,background .15s;
}
.search-bar .box svg{flex:none;margin-left:2px}
.search-bar .box:focus-within{border-color:var(--acc);background:var(--card)}
.search-bar input{flex:1;border:none;outline:none;background:transparent;font-size:14px;min-width:0;padding:0 4px}
.search-bar input::placeholder{color:var(--ink3)}
.search-bar .do{
  border-radius:999px;padding:0 18px;height:34px;font-size:13px;font-weight:600;color:#fff;
  background:var(--acc);border:none;transition:background .15s,box-shadow .2s;position:relative;overflow:hidden;
}
.search-bar .do:hover{background:var(--acc-d);box-shadow:var(--sh-md)}

/* ================= 主视图切换 ================= */
.view{display:none;min-height:calc(100vh - 58px - var(--player-h))}
.view.on{display:block;animation:fadeUp .28s ease}
@keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}

/* ================= 轮播（深夜电台头条） ================= */
.hero{position:relative;height:clamp(214px,29vw,290px);margin:16px 16px 0;
  background:#1d1a15;border:1px solid #1d1a15;border-radius:var(--r);box-shadow:var(--sh-md);overflow:hidden}
.hero .slide{position:absolute;inset:0;display:none;cursor:pointer;overflow:hidden}
.hero .slide.on{display:flex;animation:heroIn .5s cubic-bezier(.22,.61,.36,1)}
@keyframes heroIn{from{opacity:.35;transform:scale(1.02)}to{opacity:1;transform:none}}
.hero .slide .bg{position:absolute;left:0;top:0;bottom:0;width:62%;background-size:cover;background-position:center}
.hero .slide .scrim{
  position:absolute;inset:0;display:block;
  background:linear-gradient(90deg,rgba(13,11,8,.55) 0%,rgba(13,11,8,.12) 45%,rgba(13,11,8,.15) 100%);
}
.hero .slide .cap{position:relative;margin-left:58%;padding:24px 22px 28px;display:flex;flex-direction:column;justify-content:center;min-width:0}
.hero .slide .lab{font-family:var(--mono);font-size:10px;letter-spacing:.3em;color:#ff8a3d;margin-bottom:10px;text-transform:uppercase}
.hero .slide .t{font-family:var(--serif);font-size:clamp(21px,3vw,28px);font-weight:700;letter-spacing:.03em;line-height:1.3;color:#fff;
  display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;text-shadow:0 2px 14px rgba(0,0,0,.5)}
.hero .slide .s{margin-top:9px;font-size:12px;color:rgba(255,255,255,.74);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hero .slide .play{margin-top:18px;width:42px;height:42px;border-radius:50%;background:var(--acc);display:flex;align-items:center;justify-content:center;
  box-shadow:0 4px 14px rgba(232,89,12,.5);transition:transform .15s,box-shadow .2s}
.hero .slide:hover .play{transform:scale(1.1);box-shadow:0 6px 22px rgba(232,89,12,.6)}
.hero .slide .play svg{width:17px;height:17px;color:#fff;margin-left:1px}
.hero .dots{position:absolute;right:14px;bottom:12px;display:flex;gap:6px;z-index:3}
.hero .dots i{width:8px;height:8px;border-radius:999px;background:rgba(255,255,255,.32);transition:.25s;cursor:pointer}
.hero .dots i.on{width:22px;background:var(--acc)}

/* ================= 区块（编辑部编号） ================= */
.sec{padding:26px 16px 2px}
.sec-h{display:flex;align-items:baseline;gap:10px;margin-bottom:14px}
.sec-h .num{font-family:var(--mono);font-size:10px;color:var(--acc);letter-spacing:.12em;border:1px solid var(--line2);border-radius:999px;padding:2px 8px;align-self:center}
.sec-h h2{font-family:var(--serif);font-size:21px;font-weight:700;letter-spacing:.03em}
.sec-h .sub{font-family:var(--mono);font-size:10px;color:var(--ink3);letter-spacing:.16em;text-transform:uppercase}
.sec-load,.sec-err{padding:28px 16px;text-align:center;font-size:13px;color:var(--ink3)}
.sec-err .rt{color:var(--acc);cursor:pointer;font-weight:600}

/* 猜你想听：横向卡片 */
.row{display:flex;gap:14px;overflow-x:auto;padding:2px 2px 12px;scroll-snap-type:x mandatory}
.row::-webkit-scrollbar{height:0}
.gcard{flex:none;width:122px;cursor:pointer;opacity:0;animation:cardIn .4s ease forwards;scroll-snap-align:start}
.gcard .im{position:relative;width:122px;height:122px;border-radius:var(--r);overflow:hidden;background:var(--card);
  border:1px solid var(--line);box-shadow:var(--sh);transition:transform .2s,box-shadow .25s,border-color .2s}
.gcard:hover .im{transform:translateY(-3px);box-shadow:var(--sh-md)}
.gcard .im .no{position:absolute;left:8px;top:8px;z-index:2;padding:3px 8px;font-family:var(--mono);font-size:10px;color:#fff;
  background:rgba(31,35,40,.6);border-radius:999px;letter-spacing:.08em;backdrop-filter:blur(4px)}
.gcard .im img{width:100%;height:100%;object-fit:cover;transition:transform .35s}
.gcard:hover .im img{transform:scale(1.06)}
.gcard .im .go{
  position:absolute;right:8px;bottom:8px;width:32px;height:32px;border-radius:50%;
  background:var(--acc);display:flex;align-items:center;justify-content:center;color:#fff;
  opacity:0;transform:translateY(6px) scale(.8);transition:.2s;box-shadow:0 2px 6px rgba(232,89,12,.45);
}
.gcard:hover .im .go{opacity:1;transform:none}
.gcard .im .go svg{width:15px;height:15px;margin-left:1px}
.gcard .tt{margin-top:9px;font-size:13px;font-weight:600;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;
  font-feature-settings:"kern" 1;letter-spacing:.01em}
.gcard .au{margin-top:2px;font-size:11px;color:var(--ink3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@keyframes cardIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}

/* 歌单广场：Material 方块网格 */
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(156px,1fr));gap:14px;padding-bottom:6px}
@media (max-width:380px){.grid{grid-template-columns:repeat(2,1fr)}}
.pcard{position:relative;cursor:pointer;min-width:0;background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:8px;
  box-shadow:var(--sh);transition:transform .2s,box-shadow .25s,border-color .15s;opacity:0;animation:cardIn .4s ease forwards}
.pcard:hover{transform:translateY(-3px);box-shadow:var(--sh-md);border-color:var(--line2)}
.pcard .no{position:absolute;left:10px;top:10px;z-index:3;padding:2px 8px;font-family:var(--mono);font-size:10px;font-weight:700;color:#fff;
  background:rgba(31,35,40,.58);border-radius:999px;letter-spacing:.04em;backdrop-filter:blur(4px)}
.pcard .tag{position:absolute;right:10px;top:10px;z-index:3;padding:3px 9px;font-family:var(--mono);font-size:9px;letter-spacing:.1em;color:#fff;
  border-radius:999px;box-shadow:0 1px 3px rgba(0,0,0,.25)}
.pcard .im{position:relative;width:100%;aspect-ratio:1/1;overflow:hidden;border-radius:10px;background:var(--acc-l)}
.pcard .im img{width:100%;height:100%;object-fit:cover;transition:transform .35s}
.pcard:hover .im img{transform:scale(1.05)}
.pcard .im .go{position:absolute;right:8px;bottom:8px;width:30px;height:30px;border-radius:50%;background:var(--acc);display:flex;align-items:center;justify-content:center;
  color:#fff;opacity:0;transform:scale(.7);transition:.2s;box-shadow:0 2px 6px rgba(232,89,12,.45)}
.pcard:hover .im .go{opacity:1;transform:none}
.pcard .im .go svg{width:15px;height:15px;margin-left:1px}
.pcard .tt{margin-top:9px;font-family:var(--serif);font-size:15px;font-weight:700;letter-spacing:.02em;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.pcard .sub{margin-top:3px;font-family:var(--mono);font-size:10px;color:var(--ink3);letter-spacing:.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* 排行榜：Material 方块 */
.rank-row{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;padding:2px 2px 18px}
@media (max-width:760px){.rank-row{grid-template-columns:1fr}}
.rank{position:relative;background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:8px;cursor:pointer;
  box-shadow:var(--sh);transition:transform .2s,box-shadow .25s,border-color .15s;opacity:0;animation:cardIn .4s ease forwards}
.rank:hover{transform:translateY(-3px);box-shadow:var(--sh-md);border-color:var(--line2)}
.rank .r-im{position:relative;width:100%;aspect-ratio:1/1;overflow:hidden;border-radius:10px;background:var(--acc-l)}
.rank .r-im img{width:100%;height:100%;object-fit:cover;transition:transform .35s}
.rank:hover .r-im img{transform:scale(1.05)}
.rank .r-no{position:absolute;left:6px;top:5px;font-family:var(--serif);font-size:27px;font-weight:700;color:#fff;
  text-shadow:0 1px 6px rgba(0,0,0,.55);line-height:1}
.rank .r-im .go{position:absolute;right:8px;bottom:8px;width:30px;height:30px;border-radius:50%;background:var(--acc);display:flex;align-items:center;justify-content:center;
  color:#fff;opacity:0;transform:scale(.7);transition:.2s;box-shadow:0 2px 6px rgba(232,89,12,.45)}
.rank:hover .r-im .go{opacity:1;transform:none}
.rank .r-im .go svg{width:15px;height:15px;margin-left:1px}
.rank .r-tt{margin-top:9px;font-family:var(--serif);font-size:16px;font-weight:700;letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rank .r-sub{margin-top:2px;font-family:var(--mono);font-size:10px;color:var(--ink3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rank .r-more{margin-top:9px;padding-top:8px;border-top:1px solid var(--line);font-family:var(--mono);font-size:11px;color:var(--ink3);letter-spacing:.04em;transition:color .12s}
.rank:hover .r-more{color:var(--acc)}

/* 站点脚注 */
.site-foot{
  margin:6px 16px 20px;padding-top:14px;border-top:1px solid var(--line);
  font-family:var(--mono);font-size:10.5px;color:var(--ink3);letter-spacing:.06em;text-align:center;
}

/* ================= 搜索/歌单 结果列表 ================= */
.list-card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);margin:16px;overflow:hidden;box-shadow:var(--sh)}
.list-card .hd{display:flex;align-items:center;gap:10px;padding:13px 18px;border-bottom:1px solid var(--line)}
.list-card .hd .back{width:32px;height:32px;border-radius:999px;display:flex;align-items:center;justify-content:center;color:var(--ink2);transition:background .15s,color .15s}
.list-card .hd .back:hover{color:var(--acc);background:var(--acc-l)}
.list-card .hd .tt{font-family:var(--serif);font-size:18px;font-weight:700;letter-spacing:.03em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.list-card .hd .n{font-family:var(--mono);font-size:11px;color:var(--ink3)}
.list-card .hd .all{
  margin-left:auto;flex:none;display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;color:var(--acc);
  padding:8px 16px;border-radius:999px;background:var(--acc-l);transition:.18s;white-space:nowrap;position:relative;overflow:hidden;
}
.list-card .hd .all:hover{background:var(--acc);color:#fff;box-shadow:0 2px 6px rgba(232,89,12,.35)}
.list-card .hd .all:active{transform:scale(.97)}
.list-card .hd .all svg{width:14px;height:14px}
.songlist{list-style:none}
.songlist li{display:flex;align-items:center;gap:12px;padding:9px 18px;cursor:pointer;transition:background .14s;border-bottom:1px solid var(--line)}
.songlist li:last-child{border-bottom:none}
.songlist li:hover{background:var(--paper)}
.songlist li.cur{background:var(--acc-l)}
.songlist .idx{width:22px;text-align:center;font-family:var(--mono);font-size:12px;color:var(--ink3);flex:none}
.songlist li .im{width:42px;height:42px;border-radius:10px;overflow:hidden;position:relative;flex:none;background:var(--acc-l)}
.songlist li .im img{width:100%;height:100%;object-fit:cover}
.songlist li .im .eq{position:absolute;inset:0;display:none;align-items:center;gap:2px;justify-content:center;background:rgba(15,23,42,.38)}
.songlist li.cur .im .eq{display:flex}
.songlist li .im .eq i{width:3px;background:#fff;animation:eq 1s ease-in-out infinite}
.songlist li .im .eq i:nth-child(2){animation-delay:.25s}
.songlist li .im .eq i:nth-child(3){animation-delay:.5s}
@keyframes eq{0%,100%{height:6px}50%{height:16px}}
.songlist .meta{flex:1;min-width:0}
.songlist .meta .t{font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:.01em}
.songlist li.cur .meta .t{color:var(--acc)}
.songlist .meta .s{font-size:11.5px;color:var(--ink3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
.songlist .dur{font-family:var(--mono);font-size:11px;color:var(--ink3);flex:none}
.songlist .empty{padding:60px 16px;text-align:center;font-size:13px;color:var(--ink3)}

/* ================= 底部播放器（深夜电台 · 黑胶墨底） ================= */
.player{
  position:fixed;left:0;right:0;bottom:0;z-index:60;background:#1d1a15;
  border-top:1px solid rgba(255,255,255,.08);box-shadow:0 -6px 28px rgba(20,15,8,.22);
  padding-bottom:env(safe-area-inset-bottom);
}
.p-prog{height:4px;background:rgba(255,255,255,.16);position:relative;cursor:pointer;touch-action:none;user-select:none}
.p-prog .fill{position:absolute;left:0;top:0;bottom:0;background:var(--acc);width:0%;transition:width .2s linear}
.p-prog .knob{position:absolute;top:50%;width:13px;height:13px;border-radius:50%;background:#fff;border:2px solid var(--acc);box-shadow:0 1px 4px rgba(0,0,0,.4);transform:translate(-50%,-50%) scale(0);transition:transform .15s}
.p-prog:hover .knob,.p-prog.drag .knob{transform:translate(-50%,-50%) scale(1)}
.p-main{display:flex;align-items:center;gap:14px;padding:9px 16px;height:var(--player-h)}
.p-cov{position:relative;flex:none;width:56px;height:56px;border-radius:var(--r);overflow:hidden;background:rgba(255,255,255,.1);cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.4)}
.p-cov img{width:100%;height:100%;object-fit:cover}
.p-cov .mask{position:absolute;inset:0;background:rgba(13,11,8,.5);display:none;align-items:center;justify-content:center;color:#fff}
.p-cov.live .mask{display:flex}
.p-cov .mask svg{width:22px;height:22px}
.p-now{flex:1;min-width:0;cursor:pointer}
.p-now .lab{font-family:var(--mono);font-size:9px;letter-spacing:.22em;color:rgba(255,255,255,.5);margin-bottom:3px}
.p-now .t{font-size:14.5px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:.01em}
.p-now .s{font-family:var(--mono);font-size:10.5px;color:rgba(255,255,255,.55);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px;letter-spacing:.02em}
.p-ctrl{display:flex;align-items:center;gap:4px;flex:none}
.p-ctrl button{width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.92);transition:.15s;position:relative;overflow:hidden}
.p-ctrl button:hover{background:rgba(255,255,255,.14);color:#fff}
.p-ctrl button:active{transform:scale(.92)}
.p-ctrl button svg{width:20px;height:20px}
.p-ctrl .play{width:48px;height:48px;color:#fff;background:var(--acc);margin:0 2px;box-shadow:0 4px 14px rgba(232,89,12,.5)}
.p-ctrl .play:hover{background:var(--acc-d);box-shadow:0 6px 20px rgba(232,89,12,.55);color:#fff}
.p-ctrl .play svg{width:22px;height:22px}
.p-ctrl .mode{width:auto;padding:0 10px;border-radius:999px;font-family:var(--mono);font-size:11px;color:rgba(255,255,255,.6)}
.p-ctrl .mode:hover{background:rgba(232,89,12,.2);color:#ffb27d;border-radius:999px}
.p-side{display:flex;align-items:center;gap:2px;flex:none}
.p-side .tm{font-family:var(--mono);font-size:11px;color:rgba(255,255,255,.55);padding-right:8px;letter-spacing:.02em}
.p-side .more-btn{width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.8);transition:.15s}
.p-side .more-btn:hover{color:#fff;background:rgba(255,255,255,.14)}
.p-side .more-btn svg{width:19px;height:19px}
@media (max-width:560px){
  .p-now .lab{display:none}
  .p-side .tm{display:none}
  .p-ctrl .mode{display:none}
}

/* ================= 全页面歌词栏（点击左下角封面打开） ================= */
.lyr{
  position:fixed;inset:0;z-index:90;display:none;
  background:#101014;overflow:hidden;
  flex-direction:column;
}
.lyr.on{display:flex;animation:lyrIn .26s ease}
@keyframes lyrIn{from{opacity:0;transform:scale(1.015)}to{opacity:1;transform:none}}
.lyr .bg{position:absolute;inset:-40px;background-size:cover;background-position:center;filter:blur(44px) brightness(.42) saturate(.9)}
.lyr .scrim{position:absolute;inset:0;background:
    linear-gradient(180deg,rgba(8,8,11,.8) 0%,rgba(8,8,11,.28) 30%,rgba(8,8,11,.34) 58%,rgba(8,8,11,.9) 100%)}
.lyr .top{position:relative;z-index:2;display:flex;align-items:center;gap:10px;padding:14px 16px;color:#fff}
.lyr .top .tt{flex:1;min-width:0}
.lyr .top .tt b{font-family:var(--serif);font-size:16px;font-weight:700;letter-spacing:.04em;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lyr .top .tt span{font-family:var(--mono);font-size:11px;opacity:.65;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px;letter-spacing:.04em}
.lyr .top .now{font-family:var(--mono);font-size:9px;letter-spacing:.22em;opacity:.55;flex:none}
.lyr .close{position:relative;z-index:2;margin-left:6px;width:38px;height:38px;border-radius:50%;color:#fff;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.14);transition:.18s;overflow:hidden}
.lyr .close:hover{background:rgba(255,255,255,.28)}
.lyr .disc-zone{position:relative;z-index:2;display:flex;justify-content:center;padding:2px 0 0}
.lyr .disc{position:relative;width:min(42vh,292px);height:min(42vh,292px);flex:none}
.lyr .disc .groove{
  position:absolute;inset:10px;border-radius:50%;
  background:repeating-conic-gradient(rgba(255,255,255,.14) 0 5deg,transparent 5deg 10deg);
  border:1px solid rgba(255,255,255,.22);
}
.lyr .disc .art{
  position:absolute;inset:0;border-radius:50%;overflow:hidden;
  box-shadow:0 16px 60px rgba(0,0,0,.6);
  animation:spin 18s linear infinite;animation-play-state:paused;
}
.lyr .disc.playing .art{animation-play-state:running}
@keyframes spin{to{transform:rotate(360deg)}}
.lyr .disc .art img{width:100%;height:100%;object-fit:cover}
.lyr .disc .hole{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:18px;height:18px;border-radius:50%;background:#101014;border:4px solid rgba(255,255,255,.3)}
.lyr .lrc-box{
  position:relative;z-index:2;flex:1 1 auto;min-height:0;overflow:hidden;
  -webkit-mask-image:linear-gradient(180deg,transparent,#000 20%,#000 80%,transparent);
  mask-image:linear-gradient(180deg,transparent,#000 20%,#000 80%,transparent);
}
.lyr .lrc-wrap{position:relative;height:100%}
.lyr .lrc-tr{position:relative;text-align:center;transition:transform .55s cubic-bezier(.22,.61,.36,1)}
.lyr .l-line{padding:6px 20px;font-family:var(--sans);font-size:14.5px;color:rgba(255,255,255,.42);transition:transform .35s,opacity .35s,color .35s;cursor:pointer;line-height:1.55;word-break:break-word;letter-spacing:.02em}
.lyr .l-line.acti{color:#fff;font-size:19px;font-weight:700;font-family:var(--serif);transform:scale(1.02);text-shadow:0 3px 26px rgba(0,0,0,.55);padding:12px 20px}
.lyr .l-line.meta{opacity:.6;cursor:default}
.lyr .hint{position:relative;z-index:2;text-align:center;padding:6px 0 2px;font-family:var(--mono);font-size:10px;letter-spacing:.14em;color:rgba(255,255,255,.4)}
.lyr .lyr-prog{position:relative;z-index:2;height:3px;background:rgba(255,255,255,.18);margin:0 30px 10px;cursor:pointer;touch-action:none}
.lyr .lyr-prog .fill{position:absolute;left:0;top:0;bottom:0;background:var(--acc);width:0%}
.lyr .lyr-prog .knob{position:absolute;top:50%;width:11px;height:11px;border-radius:50%;background:#fff;transform:translate(-50%,-50%) scale(0);transition:transform .15s}
.lyr .lyr-prog:hover .knob,.lyr .lyr-prog.drag .knob{transform:translate(-50%,-50%) scale(1)}
.lyr .bottom{position:relative;z-index:2;display:flex;align-items:center;justify-content:center;gap:18px;padding:8px 16px 26px}
.lyr .bottom .tm{width:52px;font-family:var(--mono);font-size:11px;color:rgba(255,255,255,.6);text-align:center}
.lyr .bottom .sbtn{width:50px;height:50px;border-radius:50%;color:#fff;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.14);transition:.18s;overflow:hidden}
.lyr .bottom .sbtn:hover{background:rgba(255,255,255,.3)}
.lyr .bottom .sbtn svg{width:22px;height:22px}
.lyr .bottom .play{width:60px;height:60px;background:var(--acc);box-shadow:0 4px 16px rgba(232,89,12,.45)}
.lyr .bottom .play:hover{background:var(--acc-d)}
.lyr .bottom .play svg{width:26px;height:26px}

/* 播放列表弹层 */
.mini-list{position:fixed;right:10px;bottom:calc(var(--player-h) + 12px);width:min(360px,94vw);max-height:70vh;z-index:95;border-radius:var(--r);overflow:hidden;background:var(--card);box-shadow:var(--sh-md);display:none;flex-direction:column;border:1px solid var(--line)}
.mini-list.on{display:flex;animation:up .2s cubic-bezier(.22,.61,.36,1)}
@keyframes up{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
.mini-list .hd{display:flex;align-items:center;gap:8px;padding:13px 16px;border-bottom:1px solid var(--line);font-weight:600;font-size:14px}
.mini-list .hd .n{font-family:var(--mono);font-size:11px;color:var(--ink3);font-weight:400}
.mini-list .hd .x{margin-left:auto;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--ink2)}
.mini-list .hd .x:hover{background:var(--paper);color:var(--acc)}
.mini-list ol{list-style:none;overflow-y:auto}
.mini-list li{padding:9px 16px;cursor:pointer;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--line)}
.mini-list li:hover{background:var(--paper)}
.mini-list li.cur{background:var(--acc-l)}
.mini-list li .t{flex:1;min-width:0;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mini-list li .a{font-family:var(--mono);font-size:10.5px;color:var(--ink3);flex:none;max-width:90px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mini-list li.cur .t{color:var(--acc)}

/* Toast */
.toast{position:fixed;left:50%;bottom:calc(var(--player-h) + 22px);transform:translate(-50%,10px);z-index:100;
  background:rgba(29,26,21,.94);color:#fff;font-size:12.5px;padding:9px 20px;border-radius:999px;opacity:0;pointer-events:none;transition:.24s cubic-bezier(.22,.61,.36,1);max-width:80vw;text-align:center;letter-spacing:.02em;box-shadow:0 4px 16px rgba(40,30,12,.35)}
.toast.on{opacity:1;transform:translate(-50%,0)}

/* ================= 登录面板（oauth.107211.xyz） ================= */
.mask-layer{position:fixed;inset:0;background:rgba(31,35,40,.45);z-index:120;display:none;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px)}
.mask-layer.on{display:flex;animation:fadeIn .18s ease}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
.panel{width:min(390px,100%);background:var(--card);border-radius:calc(var(--r) + 6px);overflow:hidden;box-shadow:0 24px 60px rgba(31,35,40,.3);animation:pop .26s cubic-bezier(.2,.9,.3,1.15)}
@keyframes pop{from{opacity:0;transform:scale(.96) translateY(8px)}to{opacity:1;transform:scale(1) translateY(0)}}
.panel .ph{display:flex;align-items:center;gap:10px;padding:17px 20px 6px}
.panel .ph b{font-family:var(--sans);font-size:16px;letter-spacing:.02em}
.panel .ph .x{margin-left:auto;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--ink2)}
.panel .ph .x:hover{background:var(--paper);color:var(--acc)}
.panel .pd{display:flex;flex-direction:column;gap:8px;padding:14px 20px 16px}
.pv{display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid var(--line);border-radius:12px;cursor:pointer;transition:.15s}
.pv:hover{border-color:var(--acc);background:var(--acc-l)}
.pv .lg{width:34px;height:34px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:15px;font-family:var(--sans)}
.pv .nm{flex:1;font-size:14px;font-weight:600}
.pv .arr{font-size:16px;color:var(--ink3)}
.profile{display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px dashed var(--line2);border-radius:12px}
.profile .av{width:46px;height:46px;border-radius:50%;overflow:hidden;flex:none;background:var(--acc);display:flex;align-items:center;justify-content:center;color:#fff;font-family:var(--sans);font-size:17px;font-weight:700}
.profile .av img{width:100%;height:100%;object-fit:cover}
.profile .nm{font-weight:600;font-size:14.5px}
.profile .em{font-family:var(--mono);font-size:10.5px;color:var(--ink3);margin-top:2px;word-break:break-all}
.panel .foot{padding:0 20px 18px;border-top:1px solid var(--line);padding-top:11px;font-family:var(--mono);font-size:10px;color:var(--ink3);text-align:center;letter-spacing:.04em}
.panel .foot a{color:var(--acc);text-decoration:none}

/* ================= 水波纹（Material Ripple） ================= */
.ripple{position:absolute;border-radius:50%;background:rgba(232,89,12,.16);transform:scale(0);animation:rip .55s ease-out forwards;pointer-events:none;z-index:1}
@keyframes rip{to{transform:scale(1);opacity:0}}
.list-card .hd .back,.p-side .more-btn,.lyr .bottom .sbtn{position:relative;overflow:hidden}
</style>
</head>
<body>

<header class="nav">
  <div class="brand" id="brandHome">
    <span class="logo"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 18V6l10-2v12a3 3 0 1 1-2-2.83V8.6l-6 1.2V18a3 3 0 1 1-2-2.83z"/></svg></span>
    <span class="nm">云音乐</span><span class="st">STATION 107211</span>
  </div>
  <div class="nav-right">
    <button class="icon-btn" id="btnSearchOpen" title="搜索" aria-label="搜索">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
    </button>
    <button class="icon-btn" id="btnVolume" title="音量" aria-label="音量">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M16.5 12a4.5 4.5 0 0 0-2.5-4v8c1.5-.7 2.5-2.2 2.5-4z" fill="currentColor"/></svg>
    </button>
    <button class="login-btn" id="btnLogin">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 3a5 5 0 0 1 5 5v1h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h1V8a5 5 0 0 1 5-5zm0 2a3 3 0 0 0-3 3v1h6V8a3 3 0 0 0-3-3z"/></svg>
      <span id="loginTxt">登录</span>
    </button>
  </div>
</header>

<!-- 搜索条（默认隐藏，搜索出结果时显示） -->
<div class="search-bar" id="searchBar">
  <div class="box">
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#a49a87" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
    <input id="kw" placeholder="搜索歌曲、歌手" autocomplete="off" enterkeyhint="search">
    <button class="do" id="btnSearch">搜索</button>
  </div>
</div>

<!-- 视图：推荐（打开网站默认展示） -->
<section class="view on" id="view_home">
  <div class="hero" id="hero"></div>
  <div class="sec" id="sec_guess">
    <div class="sec-h"><span class="num">01</span><h2>猜你想听</h2><span class="sub">DAILY PICK</span></div>
    <div class="row" id="guessRow"><div class="sec-load">加载中…</div></div>
  </div>
  <div class="sec" id="sec_playlists">
    <div class="sec-h"><span class="num">02</span><h2>歌单广场</h2><span class="sub">MIXED PLAYLISTS</span></div>
    <div class="grid" id="plGrid"><div class="sec-load">加载中…</div></div>
  </div>
  <div class="sec" id="sec_rank">
    <div class="sec-h"><span class="num">03</span><h2>排行榜</h2><span class="sub">WEEKLY</span></div>
    <div class="rank-row" id="rankRow"><div class="sec-load">加载中…</div></div>
  </div>
  <div class="site-foot">云音乐 STATION 107211 · 数据 api.107211.xyz · 登录 oauth.107211.xyz</div>
</section>

<!-- 视图：歌单详情 -->
<section class="view" id="view_pldetail">
  <div class="list-card">
    <div class="hd">
      <button class="back" id="btnPlBack"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg></button>
      <span class="tt" id="plTitle">歌单</span><span class="n" id="plCount"></span>
      <button class="all" id="plPlayAll"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5v14l11-7z"/></svg>播放全部</button>
    </div>
    <ul class="songlist" id="plList"></ul>
  </div>
</section>

<!-- 视图：搜索结果（有结果时显示） -->
<section class="view" id="view_search">
  <div class="list-card">
    <div class="hd">
      <button class="back" id="btnBack"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg></button>
      <span class="tt">搜索结果</span><span class="n" id="resCount"></span>
      <button class="all" id="playAll"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5v14l11-7z"/></svg>播放全部</button>
    </div>
    <ul class="songlist" id="searchList"></ul>
  </div>
</section>

<!-- 底部播放器 -->
<footer class="player">
  <div class="p-prog" id="prog"><div class="fill" id="progFill"></div><div class="knob"></div></div>
  <div class="p-main">
    <div class="p-cov" id="coverBtn" title="点击查看全页面歌词">
      <img id="coverImg" alt="cover">
      <div class="mask"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></div>
    </div>
    <div class="p-now" id="nowBtn">
      <div class="lab" id="nowLab">NOW PLAYING</div>
      <div class="t" id="nowTitle">还没想好听什么</div>
      <div class="s"><span id="nowAuthor">去「猜你想听」「歌单广场」发现好音乐</span></div>
    </div>
    <div class="p-ctrl">
      <button class="mode" id="btnMode" title="播放模式">顺序</button>
      <button id="btnPrev" title="上一首"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6z"/><path d="M17 6.5v11c.8-.7 2-2 2-5.5s-1.2-4.8-2-5.5z"/></svg></button>
      <button class="play" id="btnPlay" title="播放/暂停"><svg id="playIcon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></button>
      <button id="btnNext" title="下一首"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2z"/><path d="M7 6.5v11c.8-.7 2-2 2-5.5S7.8 7.2 7 6.5z"/></svg></button>
    </div>
    <div class="p-side">
      <span class="tm"><span id="curTime">00:00</span> / <span id="durTime">00:00</span></span>
      <button class="more-btn" id="btnQueue" title="播放列表"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 6h16M4 12h10M4 18h16"/></svg></button>
    </div>
  </div>
</footer>

<!-- 全页面歌词栏 -->
<div class="lyr" id="lyrView">
  <div class="bg" id="lyrBg"></div>
  <div class="scrim"></div>
  <div class="top">
    <div class="tt"><b id="lyrTitle">正在播放</b><span id="lyrAuthor"></span></div>
    <span class="now">LYRICS</span>
    <button class="close" id="btnLyrClose" title="收起"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 5l7 7 7-7M5 19h14"/></svg></button>
  </div>
  <div class="disc-zone"><div class="disc" id="disc"><div class="groove"></div><div class="art"><img id="discImg" alt=""></div><div class="hole"></div></div></div>
  <div class="lrc-box"><div class="lrc-wrap"><div class="lrc-tr" id="lyrTr"></div></div></div>
  <div class="hint" id="lyrHint">轻触歌词行可跳转</div>
  <div class="lyr-prog" id="lyrProg"><div class="fill" id="lyrProgFill"></div><div class="knob"></div></div>
  <div class="bottom">
    <span class="tm" id="lyrCur">00:00</span>
    <button class="sbtn" id="btnLyrPrev"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6z"/><path d="M17 6.5v11c.8-.7 2-2 2-5.5s-1.2-4.8-2-5.5z"/></svg></button>
    <button class="sbtn play" id="btnLyrPlay"><svg id="lyrPlayIcon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></button>
    <button class="sbtn" id="btnLyrNext"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2z"/><path d="M7 6.5v11c.8-.7 2-2 2-5.5S7.8 7.2 7 6.5z"/></svg></button>
    <span class="tm" id="lyrDur">00:00</span>
  </div>
</div>

<!-- 播放列表弹层 -->
<div class="mini-list" id="miniList">
  <div class="hd">播放列表<span class="n" id="qlCount"></span>
    <button class="x" id="btnMiniClose"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
  </div>
  <ol id="qlBody"></ol>
</div>

<!-- 登录面板 -->
<div class="mask-layer" id="loginLayer">
  <div class="panel">
    <div class="ph"><b id="loginTitle">登录</b><button class="x" id="btnCloseLogin"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
    <div class="pd" id="providerList"></div>
    <div class="foot">经 <a href="https://oauth.107211.xyz" target="_blank" rel="noreferrer">oauth.107211.xyz</a> 授权 · 仅展示头像与昵称</div>
  </div>
</div>

<div class="toast" id="toast"></div>

<audio id="audio" preload="metadata"></audio>

<script>
/* =========================================================
   云音乐 · STATION 107211
   - 打开网站默认展示：推荐 / 猜你想听 / 推荐歌单 / 排行榜
   - 搜索栏默认隐藏，搜索出结果时显示
   - 底部播放器持续放歌，进度条置于播放组件上方
   - 播放时点击左下角歌曲图片 → 全页面歌词栏
   - 登录：oauth.107211.xyz 第三方授权登录
   ========================================================= */
(function () {
"use strict";

var S = { server: "netease", list: [], idx: -1, mode: 0, lrc: [], lrcIdx: -1, muted: false, lastVol: .85 };
var modeNames = ["顺序", "列表循环", "单曲循环"];
var modeTitles = ["顺序播放", "列表循环", "单曲循环"];
var audio = document.getElementById("audio");

/* ---------- 后端地址：跟随所在站点（worker 或直连 api.107211.xyz） ---------- */
var API_HOST = (location.hostname.indexOf("107211.xyz") >= 0) ? "" : "https://api.107211.xyz";

function apiUrl(type, id) {
  var p = "api?server=" + S.server + "&type=" + encodeURIComponent(type) + "&id=" + encodeURIComponent(id);
  return API_HOST ? (API_HOST + "/" + p) : ("/" + p);
}
function streamUrl(id) { return apiUrl("url", id); }
function coverUrl(id) {
  return API_HOST ? apiUrl("pic", id) : ("/cover?server=" + S.server + "&id=" + encodeURIComponent(id));
}
function lrcUrl(id) {
  return API_HOST ? apiUrl("lrc", id) : ("/lyric?server=" + S.server + "&id=" + encodeURIComponent(id));
}

/* ---------- 工具 ---------- */
function $(id) { return document.getElementById(id); }
function fmt(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  return ("0" + Math.floor(sec / 60)).slice(-2) + ":" + ("0" + (sec % 60)).slice(-2);
}
function hash(s) {
  var h = 0, i, c;
  for (i = 0; i < s.length; i++) { c = s.charCodeAt(i); h = ((h << 5) - h + c) | 0; }
  return Math.abs(h).toString(36);
}
function picToHttps(p) { return String(p || "").replace(/^http:/, "https:"); }
function idFromUrl(u) {
  var s = String(u || "");
  var i = s.indexOf("id=");
  if (i < 0) return "";
  return s.slice(i + 3).replace(/[^0-9].*$/, "");
}
function mapItem(raw, i) {
  raw = raw || {};
  var id = raw.id ? String(raw.id) : "";
  if (!id) id = idFromUrl(raw.url || raw.lrc || raw.pic);
  if (!id) id = "t" + hash(String(raw.title || "") + "|" + String(raw.author || "") + "|" + i);
  return {
    id: id,
    title: String(raw.title || raw.name || raw.song || "未知歌曲"),
    author: String(raw.author || raw.artist || raw.singer || "未知歌手"),
    pic: picToHttps(raw.pic || raw.cover || raw.picUrl || "")
  };
}
function toList(data) {
  var arr = Array.isArray(data) ? data : ((data && data.data) || []);
  var out = [];
  for (var i = 0; i < arr.length; i++) out.push(mapItem(arr[i], i));
  return out;
}
function getJSON(url, tries) {
  tries = (tries == null) ? 1 : tries;
  var ctrl = new AbortController();
  var timer = window.setTimeout(function () { ctrl.abort(); }, 8000);
  return fetch(url, { signal: ctrl.signal }).then(function (r) {
    window.clearTimeout(timer);
    return r.json();
  }).catch(function (err) {
    window.clearTimeout(timer);
    if (tries > 0) {
      return new Promise(function (res) { setTimeout(res, 400); }).then(function () { return getJSON(url, tries - 1); });
    }
    throw err;
  });
}
function toast(msg) {
  var t = $("toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toast.__t);
  toast.__t = setTimeout(function () { t.classList.remove("on"); }, 2200);
}
var ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
var ICON_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';

/* ---------- 首页数据 ---------- */
var PLAYLISTS = [
  { id: "pl-rank-3778678", pid: "3778678", name: "飙升榜", desc: "实时更新 · 飙升热歌", tag: "榜单", kind: "rank" },
  { id: "pl-rank-19723756", pid: "19723756", name: "热歌榜", desc: "大家都在听", tag: "榜单", kind: "rank" },
  { id: "pl-rank-3779629", pid: "3779629", name: "新歌榜", desc: "新鲜出炉", tag: "榜单", kind: "rank" },
  { id: "pl-kw-huayu", name: "华语精选", desc: "周杰伦 · 林俊杰 · 陈奕迅", tag: "华语", kind: "kw", kw: "周杰伦" },
  { id: "pl-kw-riyu", name: "日系精选", desc: "宇多田ヒカル · 米津玄師", tag: "日系", kind: "kw", kw: "宇多田ヒカル" },
  { id: "pl-kw-acg", name: "ACG 集锦", desc: "动漫主题曲大赏", tag: "ACG", kind: "kw", kw: "动漫" },
  { id: "pl-kw-lite", name: "纯音乐精选", desc: "安静的白噪音", tag: "轻音", kind: "kw", kw: "纯音乐" },
  { id: "pl-kw-edm", name: "电子 · 燃曲", desc: "节奏感拉满", tag: "电音", kind: "kw", kw: "电音" }
];
var TAG_COLORS = { "华语": "#e8590c", "日系": "#a7770a", "ACG": "#7b2fbe", "轻音": "#1a7f74", "电音": "#c2255c", "榜单": "#1d1a16" };
var GUESS_KEYWORDS = ["米津玄師", "YOASOBI", "Aimer", "LiSA", "宇多田ヒカル", "星野源", "Official髭男dism", "King Gnu", "Vaundy", "藤井風"];
var plInfo = {}, guessList = [], heroList = [], homePls = [];

function plName(id) {
  for (var i = 0; i < PLAYLISTS.length; i++) if (PLAYLISTS[i].id === id) return PLAYLISTS[i].name;
  return "歌单";
}
function fetchPlaylist(pl, cb) {
  var pr = pl.kind === "kw"
    ? getJSON(apiUrl("search", pl.kw), 2)
    : getJSON(apiUrl("playlist", pl.pid || pl.id));
  pr.then(function (data) {
    pl.list = toList(data);
    pl.cover = pl.list.length ? pl.list[0].pic : "";
    plInfo[pl.id] = pl;
    cb && cb();
  }).catch(function () {
    pl.list = [];
    pl.cover = "";
    plInfo[pl.id] = pl;
    cb && cb();
  });
}
function fetchGuess(cb) {
  guessList.length = 0;
  var used = {}, done = 0, running = 0, total = GUESS_KEYWORDS.length, cursor = 0, finished = false;
  function worker() {
    while (running < 3 && cursor < total && guessList.length < 24) {
      (function (i) {
        var kw = GUESS_KEYWORDS[i];
        running++;
        cursor++;
        getJSON(apiUrl("search", kw)).then(function (data) {
          var arr = Array.isArray(data) ? data : ((data && data.data) || []);
          for (var j = 0; j < arr.length && guessList.length < 24; j++) {
            var it = mapItem(arr[j], j);
            if (used["id:" + it.id]) continue;
            used["id:" + it.id] = 1;
            guessList.push(it);
          }
        }).catch(function () {}).then(function () {
          running--;
          done++;
          worker();
        });
      })(cursor);
    }
    if (!finished && (done >= total || guessList.length >= 24)) {
      finished = true;
      cb && cb();
    }
  }
  worker();
}
function loadHome() {
  homePls.length = 0;
  PLAYLISTS.forEach(function (pl) {
    fetchPlaylist(pl, function () {
      homePls.push(pl);
      bumpHome();
    });
  });
  fetchGuess(function () { renderGuess(); });
}
function bumpHome() {
  var pls = homePls.filter(function (p) { return p.list && p.list.length; });
  heroList = pls.slice(0, 4);
  renderHero();
  renderPlGrid();
  renderRank(pls);
}
function renderHero() {
  var hero = $("hero");
  hero.innerHTML = "";
  if (!heroList.length) return;
  var dots = document.createElement("div");
  dots.className = "dots";
  hero.appendChild(dots);
  heroList.forEach(function (pl, i) {
    var d = document.createElement("div");
    d.className = "slide" + (i === 0 ? " on" : "");
    d.innerHTML =
      '<div class="bg" style="background-image:url(\\'' + (pl.cover || "") + '\\')"></div>' +
      '<div class="scrim"></div>' +
      '<div class="cap"><div class="lab">RECOMMENDED</div><div class="t">' + escText(pl.name) + '</div><div class="s">' + escText(pl.desc || "") + '</div>' +
      '<div class="play"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></div></div>';
    d.onclick = function () { showPlDetail(pl.id); };
    hero.appendChild(d);
    var di = document.createElement("i");
    if (i === 0) di.className = "on";
    di.onclick = function (e) { e.stopPropagation(); goSlide(i); };
    dots.appendChild(di);
  });
  var cur = 0, dotsEls = dots.children;
  var real = [];
  for (var x = 0; x < hero.children.length; x++) if (hero.children[x].classList.contains("slide")) real.push(hero.children[x]);
  function goSlide(n) {
    cur = (n + heroList.length) % heroList.length;
    for (var y = 0; y < real.length; y++) real[y].classList.toggle("on", y === cur);
    for (var z = 0; z < dotsEls.length; z++) dotsEls[z].classList.toggle("on", z === cur);
  }
  window.clearInterval(hero.__t);
  hero.__t = window.setInterval(function () { goSlide(cur + 1); }, 5000);
  hero.goSlide = goSlide;
}
function escText(s) {
  return String(s == null ? "" : s).replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function renderGuess() {
  var row = $("guessRow");
  row.innerHTML = "";
  if (!guessList.length) {
    row.innerHTML = '<div class="sec-err">暂无推荐，点击 <span class="rt" id="rtGuess">重试</span></div>';
    var rt = $("rtGuess");
    if (rt) rt.onclick = function () { loadHome(); };
    return;
  }
  guessList.forEach(function (it, i) {
    var d = document.createElement("div");
    d.className = "gcard";
    d.style.animationDelay = (i * 0.04) + "s";
    d.innerHTML =
      '<div class="im"><span class="no">' + ("0" + (i + 1)).slice(-2) + '</span>' +
      '<img src="' + escAttr(it.pic) + '" loading="lazy" alt="">' +
      '<div class="go"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></div></div>' +
      '<div class="tt">' + escText(it.title) + '</div>' +
      '<div class="au">' + escText(it.author) + '</div>';
    d.onclick = function () { setQueue(guessList, i); };
    row.appendChild(d);
  });
  plImgFallback(row);
}
function renderPlGrid() {
  var grid = $("plGrid");
  grid.innerHTML = "";
  var pls = PLAYLISTS.filter(function (p) { return p.list && p.list.length; });
  if (!pls.length) {
    grid.innerHTML = '<div class="sec-err">内容加载失败，点击 <span class="rt" id="rtPl">重试</span></div>';
    var rt = $("rtPl");
    if (rt) rt.onclick = function () { loadHome(); };
    return;
  }
  pls.forEach(function (pl, pi) {
    var d = document.createElement("div");
    d.className = "pcard";
    d.style.animationDelay = (pi * 0.05) + "s";
    var tagc = TAG_COLORS[pl.tag] || "#3c4043";
    var no = ("0" + (pi + 1)).slice(-2);
    d.innerHTML =
      '<span class="no">' + no + '</span>' +
      '<span class="tag" style="background:' + tagc + '">' + escText(pl.tag || "歌单") + '</span>' +
      '<div class="im">' +
      '<img src="' + escAttr(pl.cover || "") + '" loading="lazy" alt="">' +
      '<div class="go"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></div></div>' +
      '<div class="tt">' + escText(pl.name) + '</div>' +
      '<div class="sub">' + escText(pl.desc || "") + '</div>';
    d.onclick = function () { showPlDetail(pl.id); };
    grid.appendChild(d);
  });
  plImgFallback(grid);
}
function renderRank(pls) {
  var row = $("rankRow");
  row.innerHTML = "";
  var top3 = pls.filter(function (p) { return p.kind === "rank"; }).slice(0, 3);
  if (!top3.length) {
    row.innerHTML = '<div class="sec-err">排行榜加载失败，点击 <span class="rt" id="rtRank">重试</span></div>';
    var rt = $("rtRank");
    if (rt) rt.onclick = function () { loadHome(); };
    return;
  }
  top3.forEach(function (pl, ri) {
    var rank = document.createElement("div");
    rank.className = "rank";
    rank.style.animationDelay = (ri * 0.08) + "s";
    rank.innerHTML =
      '<div class="r-im"><img src="' + escAttr(pl.cover || "") + '" loading="lazy" alt="">' +
      '<span class="r-no">' + (ri + 1) + '</span>' +
      '<span class="go"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span></div>' +
      '<div class="r-tt">' + escText(pl.name) + '</div>' +
      '<div class="r-sub">' + escText(pl.desc || "热门榜单") + '</div>' +
      '<div class="r-more">点开看全部 ›</div>';
    rank.onclick = function () { showPlDetail(pl.id); };
    row.appendChild(rank);
  });
  plImgFallback(row);
}
function plImgFallback(scope) {
  var imgs = scope.querySelectorAll("img");
  for (var i = 0; i < imgs.length; i++) {
    imgs[i].onerror = function () {
      this.onerror = null;
      this.src = placeholderSrc();
    };
  }
}
function placeholderSrc() {
  var c1 = 214 + Math.floor(Math.random() * 26);
  var c2 = 204 + Math.floor(Math.random() * 26);
  var c3 = 178 + Math.floor(Math.random() * 22);
  return "data:image/svg+xml;utf8," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="rgb(' + c1 + ',' + c2 + ',' + c3 + ')"/><text x="100" y="118" font-size="60" text-anchor="middle" fill="rgba(40,30,15,0.3)">♪</text></svg>'
  );
}

/* ---------- 视图切换 ---------- */
var VIEWS = ["view_home", "view_pldetail", "view_search"];
function showView(name) {
  VIEWS.forEach(function (v) { $(v).classList.toggle("on", v === name); });
  if (name !== "view_search") hideSearchBar();
}
function showHome() { showView("view_home"); }
function showPlDetail(id) {
  var pl = plInfo[id];
  if (!pl) {
    fetchPlaylist({ id: id }, function () { showPlDetail(id); });
    return;
  }
  if (!pl.list || !pl.list.length) { toast("歌单暂无内容"); return; }
  showView("view_pldetail");
  S.list = pl.list.slice();
  S.idx = -1;
  $("plTitle").textContent = plName(id);
  $("plCount").textContent = pl.list.length + " 首";
  renderSonglist($("plList"), S.list);
}
function showSearchResults() {
  showView("view_search");
  openSearchBar();
}

/* ---------- 搜索 ---------- */
function openSearchBar() {
  var bar = $("searchBar");
  if (!bar.classList.contains("open")) {
    bar.classList.add("open");
    $("kw").focus();
  } else {
    $("kw").focus();
  }
}
function hideSearchBar() { $("searchBar").classList.remove("open"); }
function doSearch() {
  var q = $("kw").value.trim();
  if (!q) { toast("请输入搜索关键词"); return; }
  openSearchBar();
  showView("view_search");
  var ul = $("searchList");
  ul.innerHTML = '<li class="empty">搜索中…</li>';
  $("resCount").textContent = "";
  getJSON(apiUrl("search", q)).then(function (data) {
    S.list = toList(data);
    S.idx = -1;
    $("resCount").textContent = S.list.length + " 首";
    renderSonglist(ul, S.list);
  }).catch(function () {
    ul.innerHTML = '<li class="empty">搜索失败，请稍后重试</li>';
    $("resCount").textContent = "";
  });
}
function renderSonglist(ul, list) {
  ul.innerHTML = "";
  if (!list.length) {
    ul.innerHTML = '<li class="empty">没有结果</li>';
    return;
  }
  for (var i = 0; i < list.length; i++) {
    (function (it, idx) {
      var li = document.createElement("li");
      if (idx === S.idx) li.className = "cur";
      li.innerHTML =
        '<span class="idx">' + (idx + 1) + '</span>' +
        '<span class="im"><img src="' + escAttr(it.pic) + '" loading="lazy" alt="">' +
        '<span class="eq"><i></i><i></i><i></i></span></span>' +
        '<div class="meta"><div class="t">' + escText(it.title) + '</div><div class="s">' + escText(it.author) + '</div></div>';
      li.onclick = function () { playFromList(list, idx); };
      ul.appendChild(li);
    })(list[i], i);
  }
  plImgFallback(ul);
}
function escAttr(s) {
  return escText(s).replace(/"/g, "&quot;");
}

/* ---------- 播放 ---------- */
function setQueue(list, idx) {
  S.list = list.slice();
  S.idx = -1;
  renderQueue();
  playItem(idx);
}
function playFromList(list, idx) {
  S.list = list.slice();
  renderQueue();
  playItem(idx);
  highlightLists();
}
function onPlayFail(err) {
  var now = Date.now();
  if (S.failAt && now - S.failAt < 1500) return;
  S.failAt = now;
  if (err && err.name === "NotAllowedError") { setPlaying(false); return; }
  var code = audio.error ? audio.error.code : 0;
  var msg = "播放出错，请尝试切换其他歌曲";
  if (code === 2) msg = "网络异常，音乐加载失败";
  else if (code === 3) msg = "音频解码失败";
  else if (code === 4) msg = "该音乐源暂不支持播放";
  toast(msg);
  setPlaying(false);
  var hadSrc = !!audio.src;
  audio.removeAttribute("src");
  try { audio.load(); } catch (e) {}
  if (hadSrc && !(S.mode === 2) && S.list.length > 1) {
    S.failGuard = (S.failGuard || 0) + 1;
    if (S.failGuard <= 2) {
      var next = S.idx + 1;
      if (next >= S.list.length) next = 0;
      setTimeout(function () { playItem(next); }, 1200);
      return;
    }
  }
  S.failGuard = 0;
}
function playItem(i) {
  var it = S.list[i];
  if (!it) return;
  S.idx = i;
  S.lrc = [];
  S.lrcIdx = -1;
  $("nowTitle").textContent = it.title;
  $("nowAuthor").textContent = it.author;
  var cov = coverUrl(it.id);
  $("coverImg").src = cov;
  $("discImg").src = cov;
  $("lyrBg").style.backgroundImage = "url('" + cov + "')";
  var ci = $("coverImg");
  ci.onerror = function () { ci.src = placeholderSrc(); };
  audio.src = streamUrl(it.id);
  audio.play().then(function () { setPlaying(true); }).catch(function (err) { onPlayFail(err); });
  loadLrc(it.id);
  highlightLists();
  $("coverBtn").classList.add("live");
}
function highlightLists() {
  var lists = document.querySelectorAll(".songlist");
  for (var l = 0; l < lists.length; l++) {
    var lis = lists[l].children;
    for (var i = 0; i < lis.length; i++) lis[i].classList.toggle("cur", i === S.idx);
  }
  var ql = $("qlBody").children;
  for (var j = 0; j < ql.length; j++) ql[j].classList.toggle("cur", j === S.idx);
}
function setPlaying(on) {
  $("playIcon").innerHTML = on ? '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>' : '<path d="M8 5v14l11-7z"/>';
  $("lyrPlayIcon").innerHTML = on ? '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>' : '<path d="M8 5v14l11-7z"/>';
  $("disc").classList.toggle("playing", on);
}

/* ---------- 歌词 ---------- */
function loadLrc(id) {
  $("lyrTr").innerHTML = '<div class="l-line meta">歌词加载中…</div>';
  fetch(lrcUrl(id)).then(function (r) { return r.text(); }).then(function (txt) {
    S.lrc = parseLrc(txt);
    renderLrc();
  }).catch(function () {
    S.lrc = [];
    $("lyrTr").innerHTML = '<div class="l-line meta">无歌词</div>';
  });
}
function parseLrc(text) {
  var rows = [];
  var lines = String(text || "").split(String.fromCharCode(10));
  var i, j, line, rest, times, tag, p, mm, ss, content;
  for (i = 0; i < lines.length; i++) {
    line = lines[i].trim();
    if (!line) continue;
    times = [];
    rest = line;
    while (rest.charAt(0) === "[") {
      var end = rest.indexOf("]");
      if (end < 0) break;
      tag = rest.slice(1, end);
      p = tag.indexOf(":");
      if (p <= 0) break;
      mm = Number(tag.slice(0, p));
      ss = Number(tag.slice(p + 1).replace(",", "."));
      if (!isFinite(mm) || !isFinite(ss)) break;
      times.push(mm * 60 + ss);
      rest = rest.slice(end + 1);
    }
    content = rest.trim() || "♪";
    if (times.length) {
      for (j = 0; j < times.length; j++) rows.push({ t: times[j], c: content });
    } else if (content !== "♪") {
      rows.push({ t: -1, c: content });
    }
  }
  rows.sort(function (a, b) { return a.t - b.t; });
  var out = [], cur, nxt;
  for (i = 0; i < rows.length; i++) {
    cur = rows[i];
    nxt = rows[i + 1];
    if (nxt && cur.t >= 0 && Math.abs(nxt.t - cur.t) < 0.5 && cur.c !== nxt.c && cur.c !== "♪" && nxt.c !== "♪") {
      out.push({ t: cur.t, c: cur.c, tl: nxt.c });
      i++;
    } else {
      out.push({ t: cur.t, c: cur.c, tl: "" });
    }
  }
  return out;
}
function renderLrc() {
  var tr = $("lyrTr");
  tr.innerHTML = "";
  tr.style.transform = "translateY(0px)";
  if (!S.lrc.length) {
    tr.innerHTML = '<div class="l-line meta">无歌词</div>';
    return;
  }
  for (var i = 0; i < S.lrc.length; i++) {
    (function (it, idx) {
      var d = document.createElement("div");
      d.className = "l-line" + (idx === S.lrcIdx ? " acti" : "");
      d.textContent = it.c;
      if (it.tl) {
        var s2 = document.createElement("div");
        s2.style.fontSize = ".72em";
        s2.style.opacity = ".75";
        s2.textContent = it.tl;
        d.appendChild(s2);
      }
      d.onclick = function () { if (it.t >= 0 && isFinite(audio.duration) && audio.duration) audio.currentTime = it.t; };
      tr.appendChild(d);
    })(S.lrc[i], i);
  }
  scrollLrc();
}
function scrollLrc() {
  var wrap = document.querySelector(".lrc-wrap");
  var tr = $("lyrTr");
  var kids = tr.children;
  if (!kids.length || S.lrcIdx < 0 || S.lrcIdx >= kids.length) return;
  var boxH = wrap.clientHeight || 320;
  var el = kids[S.lrcIdx];
  var target = el.offsetTop + el.offsetHeight / 2;
  var off = Math.round(boxH / 2 - target);
  tr.style.transform = "translateY(" + Math.max(off, -el.offsetTop) + "px)";
}
function updateLrc() {
  if (!S.lrc.length) return;
  var t = audio.currentTime, idx = -1;
  for (var i = S.lrc.length - 1; i >= 0; i--) {
    if (S.lrc[i].t >= 0 && S.lrc[i].t <= t) { idx = i; break; }
  }
  if (idx === S.lrcIdx) return;
  S.lrcIdx = idx;
  var kids = $("lyrTr").children;
  for (var j = 0; j < kids.length; j++) kids[j].classList.toggle("acti", j === idx);
  scrollLrc();
}

/* ---------- 播放队列 ---------- */
function renderQueue() {
  var ol = $("qlBody");
  ol.innerHTML = "";
  $("qlCount").textContent = S.list.length ? "(" + S.list.length + ")" : "";
  for (var i = 0; i < S.list.length; i++) {
    (function (it, idx) {
      var li = document.createElement("li");
      if (idx === S.idx) li.className = "cur";
      li.innerHTML = '<span class="t">' + escText(it.title) + '</span><span class="a">' + escText(it.author) + '</span>';
      li.onclick = function () { playFromList(S.list, idx); };
      ol.appendChild(li);
    })(S.list[i], i);
  }
}
function toggleQueue() { $("miniList").classList.toggle("on"); }
function closeQueue() { $("miniList").classList.remove("on"); }

/* ---------- 进度/时间 ---------- */
function onTime() {
  var d = isFinite(audio.duration) ? audio.duration : 0;
  var pct = d ? (audio.currentTime / d * 100) : 0;
  $("progFill").style.width = pct + "%";
  $("prog").querySelector(".knob").style.left = pct + "%";
  $("lyrProgFill").style.width = pct + "%";
  $("lyrProg").querySelector(".knob").style.left = pct + "%";
  $("curTime").textContent = fmt(audio.currentTime);
  $("durTime").textContent = fmt(d);
  $("lyrCur").textContent = fmt(audio.currentTime);
  $("lyrDur").textContent = fmt(d);
  updateLrc();
}
function bindSeek(bar, fillId, knobSel) {
  var dragging = false;
  function pos(e) {
    var r = bar.getBoundingClientRect();
    var x = e.clientX - r.left;
    return Math.max(0, Math.min(1, x / r.width));
  }
  function seekTo(p) {
    if (isFinite(audio.duration) && audio.duration) audio.currentTime = p * audio.duration;
  }
  bar.addEventListener("pointerdown", function (e) {
    dragging = true;
    bar.classList.add("drag");
    bar.setPointerCapture(e.pointerId);
    seekTo(pos(e));
  });
  bar.addEventListener("pointermove", function (e) {
    if (!dragging) return;
    var p = pos(e);
    $(fillId).style.width = (p * 100) + "%";
    bar.querySelector(knobSel).style.left = (p * 100) + "%";
    seekTo(p);
  });
  bar.addEventListener("pointerup", function () {
    dragging = false;
    bar.classList.remove("drag");
  });
  bar.addEventListener("pointercancel", function () {
    dragging = false;
    bar.classList.remove("drag");
  });
}
function onEnded() {
  if (S.mode === 2) { audio.currentTime = 0; audio.play(); return; }
  if (S.idx < S.list.length - 1) { playItem(S.idx + 1); return; }
  if (S.mode === 1) { playItem(0); return; }
  setPlaying(false);
}

/* ---------- 全页面歌词 ---------- */
function openLyrics() {
  if (!S.list.length || S.idx < 0) { toast("还没有播放的歌曲"); return; }
  $("lyrView").classList.add("on");
  $("lyrTitle").textContent = $("nowTitle").textContent;
  $("lyrAuthor").textContent = $("nowAuthor").textContent;
  window.setTimeout(scrollLrc, 60);
}
function closeLyrics() { $("lyrView").classList.remove("on"); }

/* ---------- 登录（oauth.107211.xyz） ---------- */
var LOGIN_HOST = "https://oauth.107211.xyz";
var OAUTH_PROVIDERS = [
  { id: "github", name: "GitHub", color: "#24292f", letter: "GH" },
  { id: "twitter", name: "Twitter / X", color: "#000000", letter: "X" },
  { id: "microsoft", name: "Microsoft", color: "#d83b01", letter: "MS" }
];
function currentUser() {
  try { return JSON.parse(localStorage.getItem("mus_user") || "null"); } catch (e) { return null; }
}
function saveUser(u) {
  try { localStorage.setItem("mus_user", JSON.stringify(u)); } catch (e) {}
}
function clearUser() {
  try { localStorage.removeItem("mus_user"); } catch (e) {}
}
function renderUser(u) {
  var btn = $("btnLogin");
  if (u && u.name) {
    btn.classList.add("user");
    btn.innerHTML =
      '<span class="av">' + (u.avatar ? '<img src="' + escAttr(u.avatar) + '" alt="">' : escText((u.name || "?").charAt(0))) + '</span>' +
      '<span class="nm">' + escText(u.name) + '</span>';
    btn.title = u.email || u.provider || "";
  } else {
    btn.classList.remove("user");
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 3a5 5 0 0 1 5 5v1h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h1V8a5 5 0 0 1 5-5zm0 2a3 3 0 0 0-3 3v1h6V8a3 3 0 0 0-3-3z"/></svg><span>登录</span>';
    btn.title = "登录";
  }
}
function openLogin() {
  $("loginLayer").classList.add("on");
  var u = currentUser();
  var box = $("providerList");
  box.innerHTML = "";
  $("loginTitle").textContent = u && u.name ? "已登录" : "登录";
  if (u && u.name) {
    var pf = document.createElement("div");
    pf.className = "profile";
    pf.innerHTML =
      '<span class="av">' + (u.avatar ? '<img src="' + escAttr(u.avatar) + '" alt="">' : escText((u.name || "?").charAt(0))) + '</span>' +
      '<div><div class="nm">' + escText(u.name) + '</div>' +
      (u.email ? '<div class="em">' + escText(u.email) + '</div>' : '') +
      (u.provider ? '<div class="em">via ' + escText(u.provider) + '</div>' : '') +
      '</div>';
    box.appendChild(pf);
    var lo = document.createElement("div");
    lo.className = "pv";
    lo.innerHTML = '<span class="lg" style="background:#8a9098">↪</span><span class="nm">退出登录</span><span class="arr">›</span>';
    lo.onclick = function () { doLogout(); };
    box.appendChild(lo);
  } else {
    OAUTH_PROVIDERS.forEach(function (p) {
      var d = document.createElement("div");
      d.className = "pv";
      d.innerHTML = '<span class="lg" style="background:' + p.color + '">' + p.letter + '</span><span class="nm">' + p.name + '</span><span class="arr">›</span>';
      d.onclick = function () {
        location.href = LOGIN_HOST + "/auth/" + p.id + "?ref=" + encodeURIComponent(location.href);
      };
      box.appendChild(d);
    });
  }
}
function closeLogin() { $("loginLayer").classList.remove("on"); }
function doLogout() {
  clearUser();
  closeLogin();
  renderUser(null);
  toast("已退出登录");
}
function parseLoginReturn() {
  var q = new URLSearchParams(location.search);
  if (q.get("oauth_success") === "1") {
    var u = {
      name: q.get("name") || "用户",
      username: q.get("username") || "",
      email: q.get("email") || "",
      avatar: q.get("avatar") || "",
      provider: q.get("provider") || "",
      at: Date.now()
    };
    saveUser(u);
    renderUser(u);
    toast("欢迎，" + (u.name || "登录成功") + "！");
    if (history.replaceState) history.replaceState(null, "", location.pathname + location.hash);
  } else {
    var saved = currentUser();
    if (saved) renderUser(saved);
  }
}

/* ---------- 音量 ---------- */
function toggleMute() {
  if (S.muted) {
    audio.volume = S.lastVol || .85;
    S.muted = false;
  } else {
    S.lastVol = audio.volume || .85;
    audio.volume = 0;
    S.muted = true;
  }
  $("btnVolume").innerHTML = S.muted
    ? '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M16.5 12a4.5 4.5 0 0 0-2.5-4v8c1.5-.7 2.5-2.2 2.5-4z" fill="currentColor"/><path d="M18 9.5l5 5M23 9.5l-5 5" stroke="currentColor" stroke-width="1.8"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M16.5 12a4.5 4.5 0 0 0-2.5-4v8c1.5-.7 2.5-2.2 2.5-4z" fill="currentColor"/></svg>';
}

/* ---------- 事件绑定 ---------- */
document.addEventListener("pointerdown", function (e) {
  var el = e.target.closest ? e.target.closest(".icon-btn,.login-btn,.p-ctrl button,.all,.do,.back,.more-btn,.sbtn,.pv") : null;
  if (!el) return;
  var r = el.getBoundingClientRect();
  var d = Math.max(r.width, r.height) * 1.6;
  var s = document.createElement("span");
  s.className = "ripple";
  s.style.width = s.style.height = d + "px";
  s.style.left = (e.clientX - r.left - d / 2) + "px";
  s.style.top = (e.clientY - r.top - d / 2) + "px";
  el.appendChild(s);
  setTimeout(function () { s.remove(); }, 600);
});
$("btnSearchOpen").onclick = function () {
  if ($("searchBar").classList.contains("open")) hideSearchBar(); else openSearchBar();
};
$("btnSearch").onclick = doSearch;
$("kw").addEventListener("keydown", function (e) { if (e.key === "Enter") doSearch(); });
$("brandHome").onclick = showHome;
$("btnBack").onclick = showHome;
$("btnPlBack").onclick = showHome;
$("playAll").onclick = function () { if (S.list.length) setQueue(S.list, 0); };
$("plPlayAll").onclick = function () { if (S.list.length) setQueue(S.list, 0); };

$("btnPlay").onclick = function () {
  if (!audio.src) { if (S.list.length) playItem(0); return; }
  if (audio.paused) audio.play(); else audio.pause();
};
$("btnLyrPlay").onclick = function () {
  if (!audio.src) { if (S.list.length) playItem(0); return; }
  if (audio.paused) audio.play(); else audio.pause();
};
$("btnPrev").onclick = function () { if (S.list.length) playItem(S.idx > 0 ? S.idx - 1 : S.list.length - 1); };
$("btnLyrPrev").onclick = function () { if (S.list.length) playItem(S.idx > 0 ? S.idx - 1 : S.list.length - 1); };
$("btnNext").onclick = function () { if (S.list.length) playItem(S.idx < S.list.length - 1 ? S.idx + 1 : 0); };
$("btnLyrNext").onclick = function () { if (S.list.length) playItem(S.idx < S.list.length - 1 ? S.idx + 1 : 0); };
$("btnMode").onclick = function () {
  S.mode = (S.mode + 1) % 3;
  this.textContent = modeNames[S.mode];
  this.title = modeTitles[S.mode];
};
$("coverBtn").onclick = openLyrics;
$("nowBtn").onclick = openLyrics;
$("btnLyrClose").onclick = closeLyrics;
$("btnQueue").onclick = toggleQueue;
$("btnMiniClose").onclick = closeQueue;
$("btnVolume").onclick = toggleMute;
$("btnLogin").onclick = openLogin;
$("btnCloseLogin").onclick = closeLogin;
$("loginLayer").addEventListener("click", function (e) { if (e.target === this) closeLogin(); });

audio.addEventListener("timeupdate", onTime);
audio.addEventListener("play", function () { S.failGuard = 0; setPlaying(true); });
  audio.addEventListener("pause", function () { setPlaying(false); });
  audio.addEventListener("ended", onEnded);
  audio.addEventListener("error", function () { onPlayFail(); });
window.addEventListener("resize", function () { scrollLrc(); });
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") {
    if ($("lyrView").classList.contains("on")) closeLyrics();
    else if ($("miniList").classList.contains("on")) closeQueue();
    else if ($("loginLayer").classList.contains("on")) closeLogin();
  }
});

bindSeek($("prog"), "progFill", ".knob");
bindSeek($("lyrProg"), "lyrProgFill", ".knob");

audio.volume = .85;
parseLoginReturn();
loadHome();

})();
<\/script>
</body>
</html>`;

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

