# ♪ 次元星域音乐（Jigen_Seiki-Music） —— 基于Cloudflare Worker 部署的音乐播放器

## 示例站点

**V1.1版本大更新！！添加更多功能、完善网站样式、支持登录保存进度等！**

[音乐播放器（https://music.107211.xyz）](https://music.107211.xyz)

如果觉得好可以⭐star嘛~

用的我自己免费的 Meting API，要用自己的API的话在 `worker.js` 文件内改，改域名即可

需确保你自己部署的API支持网易云音乐，否则修改后无法使用

## 说明

- 音乐源：网易云 / QQ音乐 / 酷狗 / 酷我 / 百度。
**运行期实测后再用**——首次换源时会逐个平台试一次「按关键词搜索」，只把真正可用的加入换源池（结果缓存 30 分钟）。当前线上 Meting 仅网易云搜索可用，QQ 上游搜索接口已失效、其余平台直接返回 400，因此实际换源池为网易云单源；换用支持多平台搜索的 API 后无需改代码即可自动启用。
- **播放是怎么通的（2026-09 重写，改动最大的一处）**：网易云 CDN（`m80x.music.126.net` 之类）屏蔽 Cloudflare 出口 IP，Worker 顺着上游的 302 去取音频字节必然 `525`，而 `/api`、`/lyric` 这类纯 JSON / 文本端点照常正常——于是线上出现过「搜得到歌、点播放全挂、封面全空」。现在 Worker 只用 `redirect: "manual"` 把地址解出来，**音频与封面由浏览器直连 CDN**，Worker 一个字节都不中转。进度条的 `Range` 拖动由浏览器原样转交，因此拖动照常可用。
- 播放地址解析链（逐级降级，前一级失败才走下一级）：
  1. 同源 `/resolve`（推荐路径：Worker 有 HMAC 密钥和兜底链）
  2. 直连上游 `api.107211.xyz`（无 HMAC 时会失败，忽略）
  3. 搜索结果自带的直链 `au`（网易云本身就是可跟完的 302）
  三条都空才判定失败，交给重试 / 换源。
- 播放失败处理：同源重试 2 次 → 换到下一个可用音源 → 全部失败才停下（不会直接跳下一首）。每次重试都会重新解析地址（CDN 地址可能带短效参数，撞上失效地址就得重解），并附加随机 `r` 避免命中旧缓存。
- 播放状态提示：顶部一条描边提示（对勾 / 叉号 / 转圈），不居中弹窗、不遮挡操作，约 1.7s（失败 3.2s）自动消失。
- 键盘快捷键：`空格` 播放/暂停，`←` `→` 快退快进 5 秒（按住 `Shift` 为 30 秒），`↑` `↓` 调音量，`Esc` 依次关闭歌词页 / 队列 / 登录框。
- **`/health` 诊断端点**：返回 `{ state: "ok" | "degraded" | "down", audio, cover, audioVia, coverVia, detail }`。**只测「接口能否解出地址」，不再向 CDN 拉任何字节**——旧版用 `Range: bytes=0-0` 探测，失败必 525，整轮要 7 秒以上，而前端 4 秒就超时，于是判定「链路不可用」并把所有播放都推去代理，恰好推上唯一不通的那条路。现在它是毫秒级的，而且**完全不参与播放决策**，只在「所有音源都失败」之后查一次，用来区分「这首歌听不了」和「上游整体挂了」。
- 功能：搜索、播放、封面、双语歌词（原文+翻译）、三种播放方式、全设备自适应
- 无后端、无数据库、零成本

### 后端路由

| 路由 | 作用 | 上游 |
|---|---|---|
| `/api` | 搜索 / 榜单 / 歌单 JSON；`type=url`/`type=pic` 时只回 307，不跟随跳转 | `api.107211.xyz` |
| `/resolve` | 只回音频 / 封面的真实地址（`{ url, server, id, type, via }`），播放器主用 | 兜底链：`api.107211.xyz` → `api.injahow.cn` |
| `/stream` | 307 跳到音频地址 | 同 `/resolve` |
| `/cover` | 307 跳到封面地址 | 同 `/resolve`，失败再走 `music.163.com/api/song/detail` |
| `/lyric` | 歌词文本 | `api.107211.xyz` |
| `/health` | 诊断接口能否解出地址 | 兜底链，不下载音频 |

排查线上问题先看 `https://<你的域名>/health`：`state` 是 `down` 说明连地址都解不出来（上游接口整体故障），`detail` 会列出每个站点的结果；想换站点改 `build.js` 里的 `MEDIA_BASES` 即可。解地址缓存 90 秒，避免同一首歌重复解析。

> 注意：不要再把 `/stream` 改回「Worker 取流再转发」的实现。除非你的 CDN 不挡 Cloudflare 出口，否则那必然 525。`/stream` 存在的意义就是提供一个同源地址给不方便直连的调用方，它自己仍然只是跳转。

| 文件 | 作用 |
|---|---|
| `index.html` | 页面源文件（**改样式和前端逻辑改这里**） |
| `build.js` | 把 `index.html` + 后端骨架打包成 `worker.js` |
| `worker.js` | 网页部署入口（自动生成，勿手改） |
| `wrangler.toml` | 部署配置 |
| `package.json` | 集成必需依赖与部署脚本 |

## 本地构建

```bash
cd d:\desktop\za\music
node build.js        # 生成 worker.js
npx wrangler deploy # 部署
```

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
node build.js
npx wrangler deploy
```

## 可选环境变量配置

| 变量 | 说明 |
|---|---|
| `MUSIC_TOKEN` | 上游 API 鉴权 token（HMAC-SHA1）。留空则匿名访问，通常无需配置 |

可在 Dashboard → Worker → Settings → Variables 中设置，或在 `wrangler.toml` 的 `[vars]` 中修改。
