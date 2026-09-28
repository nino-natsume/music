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
- 播放失败处理：同源重试 2 次 → 换到下一个可用音源 → 全部失败才停下（不会直接跳下一首）。重试会附加随机 `r` 参数，避免反复命中同一个失效地址。
- 播放状态提示：居中弹窗，描边对勾 / 叉号 / 转圈，配色与本站一致，失败时抖动，约 1.9s 自动消失，不遮挡操作。
- **媒体兜底链**（`/stream`、`/cover`）：主音源的音频/封面代理可能整体失效（2026-09 线上就遇到过：`/api`、`/lyric` 全部正常，只有 `/stream`、`/cover` 确定性 502，播放器直接瘫掉）。现在媒体解析会按顺序尝试多个站点，任一可用即返回；封面另有网易云官方免鉴权接口兜底。
- **媒体直连降级**（重要）：网易云 CDN 会屏蔽 Cloudflare 出口 IP，Worker 回源媒体必然 `525`，而纯 JSON / 文本端点照常正常——于是就出现「搜得到歌、点播放全挂、封面全空」这种诡异故障。页面启动时读一次 `/health`，判定媒体通道：
  - `ok` → 走 Worker 代理（`/stream` 带 `Range`，进度条可拖动）
  - `down` → 音频和封面都改由**浏览器直连**搜索结果里自带的地址，绕开 Worker。代价是上游 `type=url` 整首返回、不支持 `Range`，拖动进度条会退化，但能播。
  - 封面始终优先用搜索结果自带的直链（列表本来就这么用，只有大封面曾经走 `/cover`）。
- **`/health` 诊断端点**：返回 `{ state: "ok" | "degraded" | "down", audio, cover, detail }`。音频探测用 `Range: bytes=0-0`，成功只拉 1 字节、失败立刻返回，正反两种情况都很便宜。全部音源失败时前端据此区分「这首歌听不了」和「上游音源挂了」——`down` 时提示服务故障，不会把付费/下架曲目误报成服务异常。
- 功能：搜索、播放、封面、双语歌词（原文+翻译）、封面主题色动态跟随、全屏搜索结果页、全设备自适应
- 无后端、无数据库、零成本

### 后端路由

| 路由 | 作用 | 上游 |
|---|---|---|
| `/api` | 搜索 / 榜单 / 歌单 JSON | `api.107211.xyz` |
| `/lyric` | 歌词文本 | `api.107211.xyz` |
| `/stream` | 音频流 | 兜底链：`api.107211.xyz` → `api.injahow.cn` |
| `/cover` | 封面图 | 兜底链：同上，失败再走 `music.163.com/api/song/detail` |
| `/health` | 媒体链路健康诊断 | 探测兜底链，不下载音频 |

排查线上问题先看 `https://<你的域名>/health`：如果 `state` 是 `down`，说明 Worker 出口被挡，页面会自动切直连；`detail` 里会列出每个站点各自的 audio/cover 状态。想换站点改 `build.js` 里的 `MEDIA_BASES` 即可。

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
