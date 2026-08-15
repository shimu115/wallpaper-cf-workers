# wallpaper-cf-workers

wallpaper-cf-workers 是 wallpaper-api 的 Cloudflare Workers 图片网关。

> 主要用于图片请求路由、反向代理以及 Cloudflare 边缘缓存。
>
> 项目本身不提供图片存储、后台管理、用户系统等功能。
>
> wallpaper-api 负责提供图片数据及图片直链，wallpaper-cf-workers 负责将图片直链转换为可直接访问并支持边缘缓存的图片地址。

## 项目架构

```text
用户浏览器
  │  GET /bing/today
  ▼
Cloudflare Worker
  │  ① 查缓存（caches.default），命中直接返回
  │  ② 未命中 → 请求 wallpaper-api（askMethod=url）获取图片直链
  │  ③ 请求图片源站，流式返回图片
  │  ④ clone 后写入缓存（waitUntil，不阻塞响应）
  ▼
返回图片给浏览器
```

## 安装

```bash
npm install
```

## 本地开发

```bash
npm run dev
```

本地默认监听 `http://localhost:8787`，可通过 `http://localhost:8787/bing/today` 验证。

## 测试

```bash
npm test
```

使用 [Vitest](https://vitest.dev/) 跑自动化测试，覆盖：

- **路由/缓存主流程**（`test/worker.test.ts`）：缓存未命中 → 取直链 → 代理图片 → 写缓存；缓存命中直接返回；random 路由 `max-age=60`；HEAD 去 body；404/405；空 URL 与内网图片 URL 返回 502。
- **纯逻辑单测**（`test/proxy.test.ts`）：防 SSRF 的 `validateImageUrl`、响应头白名单与 `Cache-Control` 覆盖的 `buildImageResponse`。

测试是确定性的（mock 掉 `caches` 与 `fetch`，不依赖真实网络和 wallpaper-api），速度快，适合做部署前门禁。

> 部署前会先自动跑测试：`npm run deploy` 触发的 `predeploy` 钩子会先执行 `npm test`，**测试不通过则部署中止**。

## 环境变量

| 变量 | 说明 | 示例 |
| --- | --- | --- |
| `API_BASE_URL` | wallpaper-api 的地址（不带尾斜杠） | `https://api.example.com` |

在 `wrangler.jsonc` 的 `vars` 中配置（或通过 Cloudflare 控制台 / `wrangler secret` 设置）。

## 路由配置

| 对外路径 | wallpaper-api 路径 | 缓存 TTL |
| --- | --- | --- |
| `/bing/today` | `/api/bing/today` | 3600s |
| `/bing/random` | `/api/bing/random` | 60s |
| `/acg/random` | `/api/acg/random` | 60s |

路由在 `src/config.ts` 中配置。

## Cloudflare 部署

```bash
npm run deploy
```

## 自定义域名配置

在 Cloudflare Dashboard 中：

1. Workers & Pages → 选择本 Worker
2. Settings → Domains & Routes → Add → Custom Domain
3. 绑定 `img.example.com`

## 缓存说明

- 使用 `caches.default`，缓存 Key 为客户端请求 URL。
- `Cache-Control` 由 Worker 自己控制：非 random 路由 `max-age=3600`，random 路由 `max-age=60`。
- 缓存写入使用 `ctx.waitUntil()`，不阻塞客户端响应。
- 缓存容量与生命周期受 Cloudflare 平台限制，代码中不硬编码容量上限。
