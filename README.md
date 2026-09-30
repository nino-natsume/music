# ♪ 次元星域音乐（Jigen_Seiki-Music） —— 基于Cloudflare Worker 部署的音乐播放器

## 示例站点

[在线体验](https://music.107211.xyz)　·　如果觉得好可以 ⭐ star 嘛~

用的是一个免费公开的 Meting API。想换成自己的，改 `build.js` 里的域名即可——**但要确保你部署的 API 支持网易云音乐**，否则改了也用不了。

## 说明

### 功能

- **搜索与播放**：网易云 / QQ音乐 / 酷狗 / 酷我 / 百度，自动检测可用音源并在失败时换源
- **双语歌词**：原文 + 翻译同字号同动画，当前句放大加亮，主色取自封面
- **三种播放方式**：顺序 / 单曲 / 随机
- **收听记录**：真正出声才记，按 `server:id` 去重，上限 300 条
- **歌单导入**：粘贴歌单 ID 或网易云链接，点封面整张进播放队列
- **登录**：OAuth（GitHub / Microsoft / Twitter / GitLab / QQ）
- **键盘快捷键**：`空格` 播放/暂停，`←` `→` 快退快进 5 秒（`Shift` 为 30 秒），`↑` `↓` 调音量，`Esc` 依次关闭歌词页 / 队列 / 登录框
- 全设备自适应，**无后端、无数据库、零成本**

> **两个能力边界，先看再问**
> 1. **做不到「显示登录账号下的所有歌单」**——OAuth 身份和网易云账号没有绑定，Meting 也没有按用户列歌单的接口（`type=user` 直接 400）。歌单只能手动导入。
> 2. **收听记录和歌单只存在本机 `localStorage`**——换设备或清缓存就没了，要跨设备同步得自己接 KV / D1。

<details>
<summary><b>实现细节：播放链路与换源</b></summary>

- **播放是怎么通的（2026-09 重写，改动最大的一处）**：网易云 CDN（`m80x.music.126.net` 之类）屏蔽 Cloudflare 出口 IP，Worker 顺着上游的 302 去取音频字节必然 `525`，而 `/api`、`/lyric` 这类纯 JSON / 文本端点照常正常——于是线上出现过「搜得到歌、点播放全挂、封面全空」。现在 Worker 只用 `redirect: "manual"` 把地址解出来，**音频与封面由浏览器直连 CDN**，Worker 一个字节都不中转。进度条的 `Range` 拖动由浏览器原样转交，因此拖动照常可用。
- 播放地址解析链（逐级降级，前一级失败才走下一级）：
  1. 同源 `/resolve`（推荐路径：Worker 有 HMAC 密钥和兜底链）
  2. 直连上游 `api.107211.xyz`（无 HMAC 时会失败，忽略）
  3. 搜索结果自带的直链 `au`（网易云本身就是可跟完的 302）

  三条都空才判定失败，交给重试 / 换源。
- 播放失败处理：同源重试 2 次 → 换到下一个可用音源 → 全部失败才停下（不会直接跳下一首）。每次重试都会重新解析地址（CDN 地址可能带短效参数，撞上失效地址就得重解），并附加随机 `r` 避免命中旧缓存。
- **音源检测**：首次换源时逐个平台试一次「按关键词搜索」，只把真正可用的加入换源池（结果缓存 30 分钟）。当前线上 Meting 仅网易云搜索可用，QQ 上游搜索接口已失效、其余平台直接返回 400，因此实际换源池为网易云单源；换用支持多平台搜索的 API 后无需改代码即可自动启用。
- **主页不显示音源检测入口**：`.src-tag{display:none}` 把检测标签藏了，但后台 `scanSources()` 照旧在空闲时跑（`requestIdleCallback`，兜底 `setTimeout 900ms`），检测结果仍然驱动自动换源。要看检测结果只能自己访问 `/sources`。
- **`/health` 诊断端点**：返回 `{ state: "ok" | "degraded" | "down", audio, cover, audioVia, coverVia, detail }`。**只测「接口能否解出地址」，不再向 CDN 拉任何字节**——旧版用 `Range: bytes=0-0` 探测，失败必 525，整轮要 7 秒以上，而前端 4 秒就超时，于是判定「链路不可用」并把所有播放都推去代理，恰好推上唯一不通的那条路。现在它是毫秒级的，而且**完全不参与播放决策**，只在「所有音源都失败」之后查一次，用来区分「这首歌听不了」和「上游整体挂了」。
- 播放状态提示：顶部一条描边提示（对勾 / 叉号 / 转圈），不居中弹窗、不遮挡操作，约 1.7s（失败 3.2s）自动消失。

</details>

<details>
<summary><b>实现细节：歌词</b></summary>

- **歌词页**：不摆封面图，只有词，整列水平居中，当前播放的那句放大加亮（24px / 700）。
  - 主色取自封面：跨域读像素（`crossOrigin="anonymous"`，CDN 已回 `ACAO: *`）→ 缩到 24×24 按「出现次数 × 饱和度 × 亮度」投票滤掉黑白像素 → 写入 `--lrc-acc` / `--lrc-acc-soft` / `--lrc-acc-glow`。没给 CORS 或解码失败就安静退回白色，不影响播放。
  - 原文与翻译是同一个 `.l-line` 里的 `<span class="o">` 和 `<span class="tr">`，**共用同一套字号 / 字重 / 颜色和同一条 `lrcIn` 入场动画**，所以两句永远同步放大、同步淡入，不会一快一慢。
  - 翻译识别三种来源：同一时间戳的下一行、行尾括号 `原文 (translation)`、以及整行的 `（翻译）…` 标记；括号一律剥掉，只留纯文字。
  - 制作信息（`作词 : 黄家驹`、`混音`、`发行` 等）不算歌词，直接从列表里剔除。
- **歌词页展开 / 收起有动画**：打开播 `lyrIn`（0.4s 上浮 + 轻微缩放），内部顶栏 / 词区 / 底栏依次错开落位；关闭先播 `lyrOut`（0.3s）并临时 `pointer-events:none`，动画结束才真正 `display:none`。跟随 `prefers-reduced-motion`。

</details>

<details>
<summary><b>实现细节：登录与「我的音乐」</b></summary>

- 登录弹窗里每家平台用**自己网站的 favicon**（`PROVIDER_ICONS`），按候选顺序试加载，某个地址挂住 4 秒就换下一个；全部落空才退回色块字母。顺序按实测可达性排——`x.com` / `abs.twimg.com` 在部分网络下直接超时，Twitter / X 走 `icon.horse` 镜像。
- **「我的音乐」区块**数据全在本机 `localStorage`：
  - **收听记录**：挂在 `<audio>` 的 `playing` 事件上，只有真正出声才记，解析失败和被跳过的歌不会污染列表。按 `server:id` 去重（重播只把它顶到最前，不新增一条），上限 300 条，超了丢最旧的。存 `mus_hist`，每条 `{ id, au, server, title, author, pic, at }`——`au` 存了直链，过期了播放时会重新解析。
  - **我的歌单**：粘贴歌单 ID 或网易云歌单链接（`parsePlInput()` 认 `#/playlist?id=`、`/playlist/`、`/dj/`、纯数字），一次贴多个用逗号分隔、逐个串行请求不并发打上游。点封面把整张歌单灌进播放队列。存 `mus_pls`。
  - 导入用 `/api?type=playlist`，实测网易云可用（`id=3778678` 回 200 首）。
  - **为什么歌单名显示成「歌单 + ID」**：`type=playlist` 只回一个纯歌曲数组（`title/author/pic/url/lrc`），既没有歌单名也没有歌单封面。所以标题老老实实用 ID 顶着，副标题标明是首曲，封面也只能用首曲封面——不要拿首曲歌名冒充歌单名。

</details>

<details>
<summary><b>实现细节：界面</b></summary>

- 播放控制组用 `.p-info + .p-ctrl + .p-time` 的 `1fr auto 1fr` 栅格，上一首 / 播放 / 下一首在视口里精确居中（实测偏差 0px）。上一首、下一首、播放方式三个图标全部是纯 CSS 绘制，不用 SVG / emoji / 字体符号。
- 搜索框、Hero 提示句、「点封面看歌词」等提示语已全部删除；加载中不再留空行。
- 卡片样式统一走 Material token（`--surface-2`、`--r-lg` 等），无渐变 / 玻璃 / 发光。

</details>

### 后端路由

| 路由 | 作用 | 上游 |
|---|---|---|
| `/api` | 搜索 / 榜单 / 歌单 JSON（`type=playlist` 按 ID 取歌单，已用于「我的歌单」）；`type=url`/`type=pic` 时只回 307，不跟随跳转 | `api.107211.xyz` |
| `/resolve` | 只回音频 / 封面的真实地址（`{ url, server, id, type, via }`），播放器主用 | 兜底链：`api.107211.xyz` → `api.injahow.cn` |
| `/stream` | 307 跳到音频地址 | 同 `/resolve` |
| `/cover` | 307 跳到封面地址 | 同 `/resolve`，失败再走 `music.163.com/api/song/detail` |
| `/lyric` | 歌词文本 | `api.107211.xyz` |
| `/sources` | 音源可用性检测：逐平台试「按关键词搜索」，返回 `{ list: ["netease", ...], detail }`，结果缓存 30 分钟 | 兜底链 |
| `/health` | 诊断接口能否解出地址 | 兜底链，不下载音频 |

排查线上问题先看 `https://<你的域名>/health`：`state` 是 `down` 说明连地址都解不出来（上游接口整体故障），`detail` 会列出每个站点的结果；想换站点改 `build.js` 里的 `MEDIA_BASES` 即可。解地址缓存 90 秒，避免同一首歌重复解析。

> 注意：不要再把 `/stream` 改回「Worker 取流再转发」的实现。除非你的 CDN 不挡 Cloudflare 出口，否则那必然 525。`/stream` 存在的意义就是提供一个同源地址给不方便直连的调用方，它自己仍然只是跳转。

### 文件结构

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
