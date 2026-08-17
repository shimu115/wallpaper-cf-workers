/**
 * 项目配置与路由表。
 */

/** 客户端路由：path 为对外暴露的路径，upstream 为 wallpaper-api 上的相对路径，random 决定缓存 TTL。 */
export interface Route {
  path: string;
  upstream: string;
  random: boolean;
}

export const ROUTES: Route[] = [
  { path: "/bing/today", upstream: "/api/bing/today", random: false },
  { path: "/bing/random", upstream: "/api/bing/random", random: true },
  { path: "/acg/random", upstream: "/api/acg/random", random: true },
];

/** 缓存 TTL（秒）：非 random 路由默认 1 小时，random 路由默认 60 秒。 */
export const CACHE_TTL_DEFAULT = 3600;
export const CACHE_TTL_RANDOM = 60;

/** 上游请求超时（毫秒），wallpaper-api 与图片源站共用。 */
export const TIMEOUT_MS = 10_000;

/** 源站缺少 Content-Type 时的默认值。 */
export const DEFAULT_CONTENT_TYPE = "image/jpeg";

/** 客户端未携带 User-Agent 时的兜底值（wallpaper-api 的 bing 接口强制要求 UA）。 */
export const DEFAULT_USER_AGENT = "wallpaper-cf-workers/1.0";
