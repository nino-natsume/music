# ♪ Music Box —— Cloudflare Worker 音乐播放器

**用的我自己免费的 Meting API，要用自己的API的话在 `worker.js` 文件的第一行改，改域名即可**

**单文件全功能**：`worker.js` 一个 JS 文件 = 服务端（API 代理/鉴权/流媒体）+ 完整前端（HTML/CSS/JS 全部内联）。部署即用，没有任何第二个文件。

- 音乐源：网易云 / QQ音乐 / 酷狗 / 百度 / 酷我（多源自动切换）
- 功能：搜索、播放、封面、双语歌词（原文+翻译）、封面主题色动态跟随、全屏搜索结果页、全设备自适应
- 无后端、无数据库、零成本

## 文件说明

| 文件 | 作用 |
|---|---|
| `worker.js` | **唯一代码文件**（Worker + 内联前端），部署入口 |
| `wrangler.toml` | 部署配置（name / main / compatibility_date / MUSIC_TOKEN） |
| `package.json` | Cloudflare Git 集成所需依赖与部署脚本 |

## 部署方式

### 方式一：Cloudflare Workers ↔ GitHub 集成（推荐，绑定本仓库自动部署）

1. 确保本仓库已 Fork 至你自己的 GitHub 账号。
2. 打开 [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Worker** → **Import a repository**（连接 Git）。
3. 授权 GitHub（只读权限即可），选择对应仓库，分支不变。
4. 构建设置保持默认即可（Cloudflare 检测到 `wrangler.toml` 与 `package.json`，自动执行 `npm install` + `wrangler deploy`）。
5. 点击 **Save and Deploy**，等待 CI 完成，即可访问 `https://music-player.<你的账户>.workers.dev`。

> 之后每次 `git push` 到 `main`，Cloudflare 会自动重新部署，无需任何手动粘贴。

### 方式二：本地 wrangler 部署

```bash
cd d:\desktop\1
npx wrangler deploy
```

## 环境变量

| 变量 | 说明 |
|---|---|
| `MUSIC_TOKEN` | 上游 API 鉴权 token（HMAC-SHA1）。留空则匿名访问，通常无需配置 |

可在 Dashboard → Worker → Settings → Variables 中设置，或在 `wrangler.toml` 的 `[vars]` 中修改。
