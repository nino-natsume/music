# ♪ Music Box —— Cloudflare Worker 音乐播放器

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

1. 确保本仓库已推送至 GitHub（`main` 分支）。
2. 打开 [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Worker** → **Import a repository**（连接 Git）。
3. 授权 GitHub（只读权限即可），选择 `nino-natsume/music` 仓库，分支选 `main`。
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

## 验证清单

部署后打开页面，F12 控制台应**无任何报错**：

- [ ] 无 `SyntaxError`（如正则 `Unmatched ')'` —— 说明部署版本被转义工具破坏了，请重新走 Git 部署）
- [ ] 搜索「晴天」能返回 30 首
- [ ] 点击播放：进度条走动、封面显示、歌词（含翻译）滚动
- [ ] 歌词面板外围颜色随封面主题色变化

## 常见问题

- **前端必须由 Worker 提供**：页面所有请求走相对路径 `/api`、`/stream`、`/cover`、`/lyric`，不要单独把页面拆出去做静态托管（GitHub Pages 等），否则会 404。
- **项目名冲突**：`wrangler.toml` 中 `name = "music-player"`，若你的账户下已有同名 Worker 项目，Git 导入时会被要求重命名或选择已有项目。
- **保持源文件纯净**：`worker.js` 内含大量 `\` 转义（正则、模板字符串），任何复制粘贴/压缩/转义工具都可能损坏它。务必走 Git 部署。