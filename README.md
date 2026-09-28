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
