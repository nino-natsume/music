# ♪ 次元星域音乐

[在线体验](https://music.107211.xyz)

单文件音乐播放器，跑在 Cloudflare Worker 上。无后端、无数据库、零成本。

## 功能

- **搜索与播放**：网易云 / QQ音乐 / 酷狗 / 酷我 / 百度，启动时后台实测哪些源真能用，播放失败自动换源
- **三种播放方式**：顺序 / 单曲 / 随机
- **收听记录**：真正出声才记，按 `server:id` 去重，上限 300 条
- **歌单导入**：粘贴歌单 ID 或网易云链接，点封面整张进队列
- **登录**：OAuth（GitHub / Microsoft / Twitter / GitLab / QQ），默认关闭
- **快捷键**：`空格` 播放/暂停，`←` `→` ±5 秒（`Shift` 30 秒），`↑` `↓` 音量，`Esc` 关闭弹层

## 部署

**方式一 · Git 导入（推荐）**

1. Fork 本仓库。
2. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Worker** → **Import a repository**，连 Git，选仓库，分支和构建设置都用默认。
3. **Save and Deploy**。

**方式二 · Wrangler 部署**

```bash
node build.js
npx wrangler deploy
```

改样式或前端逻辑一律改 `index.html`，改完跑一次 `node build.js` 重新生成 `worker.js`。

## 环境变量

> Dashboard → **Workers & Pages** → 你的 Worker → **Settings** → **Variables and Secrets** → **Add variable**

| 变量 | 类型 | 值（默认） | 说明 |
|---|---|---|---|
| `OAUTH_ON` | Text | / | **【注意】此变量仅本人开启时有效，后台链接[站点辅助登录平台](https://oauth.107211.xyz/)**<br>关闭时页面里没有登录按钮，也不接受 OAuth 回调、不存播放进度、播放条上不显示账号清单 |
| `MUSIC_TOKEN` | Secret | / | 上游 API 鉴权 token（HMAC-SHA1）。留空则匿名访问 |

## 文件 & 后端路由

| 文件 | 作用 |
|---|---|
| `index.html` | 页面源文件，**改样式和前端逻辑改这里** |
| `build.js` | 把 `index.html` + 后端骨架打包成 `worker.js` |
| `worker.js` | 部署入口，自动生成，勿手改 |
| `wrangler.toml` | 部署配置 |

| 路由 | 作用 |
|---|---|
| `/api` | 搜索 / 榜单 / 歌单 JSON |
| `/resolve` | 只解出音频 / 封面地址（`{ url, server, id, type, via }`），播放器主用 |
| `/stream` `/cover` | 307 跳转到地址 |
| `/lyric` | 歌词文本 |
| `/sources` | 音源可用性检测，结果缓存 30 分钟 |
| `/health` | 诊断接口能否解出地址，**不下载音频** |
| `/config` | 回 `{ "oauth": true\|false }` |
