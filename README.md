# ♪ 次元星域音乐

[在线体验](https://music.107211.xyz)

单文件音乐播放器，跑在 Cloudflare Worker 上。无后端、无数据库、零成本。

## 功能

- **搜索与播放**：网易云 / QQ音乐 / 酷狗 / 酷我 / 百度，启动时后台实测哪些源真能用，播放失败自动换源
- **双语歌词**：原文 + 翻译，当前句居中放大加亮，主色自动取自封面
- **三种播放方式**：顺序 / 单曲 / 随机
- **收听记录**：真正出声才记，按 `server:id` 去重，上限 300 条
- **歌单导入**：粘贴歌单 ID 或网易云链接，点封面整张进队列
- **登录**：OAuth（GitHub / Microsoft / Twitter / GitLab / QQ），默认关闭
- **快捷键**：`空格` 播放/暂停，`←` `→` ±5 秒（`Shift` 30 秒），`↑` `↓` 音量，`Esc` 关闭弹层

## 两个能力边界

1. **列不出「登录账号的歌单」**——OAuth 身份和网易云账号没有绑定，Meting 也没有按用户列歌单的接口（`type=user` 直接 400）。歌单只能手动导入。
2. **数据只在本机 `localStorage`**——换设备或清缓存就没了。要跨设备同步得自己接 KV / D1。

## 部署

**方式一 · Git 导入（推荐）**

1. Fork 本仓库。
2. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Worker** → **Import a repository**，连 Git，选仓库，分支和构建设置都用默认。
3. **Save and Deploy**。

**方式二 · 本地 wrangler**

```bash
node build.js
npx wrangler deploy
```

改样式或前端逻辑一律改 `index.html`，改完跑一次 `node build.js` 重新生成 `worker.js`。

## 环境变量

变量**只在 Cloudflare Dashboard 配**，不写进 `wrangler.toml`。

> Dashboard → **Workers & Pages** → 你的 Worker → **Settings** → **Variables and Secrets** → **Add variable**

| 变量 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `OAUTH_ON` | Text | 不填 = 关 | 登录开关。关闭时页面里没有登录按钮，也不接受 OAuth 回调、不存播放进度、播放条上不显示账号清单 |
| `MUSIC_TOKEN` | Secret | 不填 | 上游 API 鉴权 token（HMAC-SHA1）。留空则匿名访问，通常不用配 |

`OAUTH_ON` 只有 `true` / `1` / `yes` / `on`（大小写空格都无所谓）算开，**其余一律算关**——包括未配置、空串、`off`、`false`、`no`、`0`，连拼错的 `"ture"` 也算关。功能开关宁可关错，不能关反。

改完**不用重新 deploy**，前端每次打开都问 Worker 要一次 `/config`。

### 开启后多出三件事

1. **登录**：身份存本机 `localStorage`。
2. **续播进度**：记住队列 + 第几首 + 播到第几秒（7 天内有效）。下次打开把界面摆好但不自动播放，点播放键接着播。
3. **播放条上的账号清单**：列出该账号名下的本地清单（收听记录 + 导入的歌单），点一个就以它为队列开唱。

> OAuth 只回 `name/email/avatar`，没有 token 也没有服务端会话，和网易云账号无关。这里的「账号清单」是**本地**清单，别当成云端同步。

## 文件

| 文件 | 作用 |
|---|---|
| `index.html` | 页面源文件，**改样式和前端逻辑改这里** |
| `build.js` | 把 `index.html` + 后端骨架打包成 `worker.js` |
| `worker.js` | 部署入口，自动生成，勿手改 |
| `wrangler.toml` | 部署配置 |

## 后端路由

| 路由 | 作用 |
|---|---|
| `/api` | 搜索 / 榜单 / 歌单 JSON |
| `/resolve` | 只解出音频 / 封面地址（`{ url, server, id, type, via }`），播放器主用 |
| `/stream` `/cover` | 307 跳转到地址 |
| `/lyric` | 歌词文本 |
| `/sources` | 音源可用性检测，结果缓存 30 分钟 |
| `/health` | 诊断接口能否解出地址，**不下载音频** |
| `/config` | 回 `{ "oauth": true\|false }` |

排查线上问题先看 `/health`：`state` 是 `down` 说明上游整体故障（连地址都解不出来），`detail` 里有每个站点的结果。想换上游站点改 `build.js` 里的 `MEDIA_BASES`。

### 播放为什么能通

网易云 CDN 屏蔽 Cloudflare 出口 IP，Worker 顺着上游的 302 去取音频字节必然 `525`，但 `/api`、`/lyric` 这类 JSON 端点照常正常——于是线上出现过「搜得到歌、点播放全挂」。

现在 Worker 只用 `redirect: "manual"` **把地址解出来**，音频和封面由浏览器直连 CDN，一个字节都不中转。进度条的 `Range` 拖动也照常可用。

> 不要把 `/stream` 改回「Worker 取流再转发」，除非你的 CDN 不挡 Cloudflare 出口，否则必然 525。

## 界面约定

- 界面上不留提示语：没有加载文案、没有空状态句子、没有「点封面看歌词」之类的引导。`statusModal()` 和 `setNow()` 的调用点原样保留，但实现在入口处被 `SHOW_STATUS` 和 `mode === "live"` 拦掉——想放回来改一处即可。搜索失败只留一个可点的重试图标，不配文字。
- 歌词当前句的放大走 `transform: scale(1.12)`，**不是 `font-size`**。字号一变行高就变，整列歌词重排、滚动定位跟着抖；`scale` 只在合成器上做变换，行高恒定。行几何一次量好就缓存，切句只动两个节点的 class，一帧内只写一次 DOM。
- 当前句的放大挂在 `.o` / `.tr`（文字本身）上而不是 `.l-line` 上，挂行上会把左右 padding 一起放大，歌词往两边溢出被裁。
- 有关键词时搜索框从 520px 长开到全幅（`searchOpen` 动画），动画只挂在 `.hero.searching` 上，清空关键词时是干净的收回而非重播。
