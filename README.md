# ♪ Online-Music —— 基于Cloudflare Worker 部署的音乐播放器

## 示例站点

[音乐播放器（https://music.107211.xyz）](https://music.107211.xyz)

如果觉得好可以⭐star嘛~

用的我自己免费的 Meting API，要用自己的API的话在 `worker.js` 文件的第一行改，改域名即可

需确保你自己部署的API支持网易云音乐，否则修改后无法使用

## 说明

- 目前 **仅支持音乐源：网易云** ，其他音乐源因 参数过期无法搜索歌曲 或 搜索结果偏差过大 故弃用
- 功能：搜索、播放、封面、双语歌词（原文+翻译）、封面主题色动态跟随、全屏搜索结果页、全设备自适应
- 无后端、无数据库、零成本

| 文件 | 作用 |
|---|---|
| `worker.js` | 网页部署入口 |
| `wrangler.toml` | 部署配置 |
| `package.json` | 集成必需依赖与部署脚本 |

## 部署方式

### 方式一：Cloudflare Workers

1. 确保本仓库已 Fork 至你自己的 GitHub 账号。
2. 打开 [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Worker** → **Import a repository**（连接 Git）。
3. 授权 GitHub（只读权限即可），选择对应仓库，分支不变。
4. 构建设置保持默认即可。
5. 点击 **Save and Deploy**，等待部署完成，即可访问 `https://music.<你的账户>.workers.dev/`。
6. 可自定义域或路由，部署后访问 `https://example.com/` 即可

### 方式二：本地 wrangler 部署

```bash
cd d:\desktop\1
npx wrangler deploy
```

## 可选环境变量配置

| 变量 | 说明 |
|---|---|
| `MUSIC_TOKEN` | 上游 API 鉴权 token（HMAC-SHA1）。留空则匿名访问，通常无需配置 |

可在 Dashboard → Worker → Settings → Variables 中设置，或在 `wrangler.toml` 的 `[vars]` 中修改。
