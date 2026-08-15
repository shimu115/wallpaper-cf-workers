import {
  CACHE_TTL_DEFAULT,
  CACHE_TTL_RANDOM,
  DEFAULT_USER_AGENT,
} from "./config";
import { matchRoute } from "./router";
import {
  buildImageResponse,
  fetchImage,
  fetchImageUrl,
  HttpError,
} from "./proxy";

export interface Env {
  API_BASE_URL: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const method = request.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      return textResponse(405, "Method Not Allowed");
    }

    const url = new URL(request.url);
    const route = matchRoute(url.pathname);
    if (!route) {
      return textResponse(404, "Not Found");
    }

    const apiBaseUrl = env.API_BASE_URL;
    if (!apiBaseUrl) {
      console.error("[Error] 环境变量 API_BASE_URL 未配置");
      return textResponse(500, "API_BASE_URL 未配置");
    }

    const userAgent = request.headers.get("User-Agent") || DEFAULT_USER_AGENT;
    const cacheKey = url.toString();

    console.log(`[Worker] ${method} ${url.pathname}`);

    // 1. 查缓存
    const cache = caches.default;
    const cached = await cache.match(cacheKey);
    if (cached) {
      console.log("[Cache] HIT");
      return method === "HEAD" ? withoutBody(cached) : cached;
    }
    console.log("[Cache] MISS");

    try {
      // 2. 请求 wallpaper-api 获取图片直链
      const imageUrl = await fetchImageUrl(apiBaseUrl, route.upstream, userAgent);
      console.log(`[API] ${apiBaseUrl}${route.upstream}?askMethod=url`);
      console.log(`[Image] ${imageUrl}`);

      // 3. 请求图片源站
      const imageResponse = await fetchImage(imageUrl, userAgent);

      // 4. 构造最终响应（Cache-Control 由 Worker 控制）
      const ttl = route.random ? CACHE_TTL_RANDOM : CACHE_TTL_DEFAULT;
      const finalResponse = buildImageResponse(imageResponse, ttl);

      // 5. 写入缓存（不阻塞响应）
      ctx.waitUntil(cache.put(cacheKey, finalResponse.clone()));
      console.log("[Cache] PUT");

      // 6. 返回
      return method === "HEAD" ? withoutBody(finalResponse) : finalResponse;
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 502;
      const message = e instanceof HttpError ? e.message : "Bad Gateway";
      console.error(`[Error] ${message}`, e);
      return textResponse(status, message);
    }
  },
};

function textResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function withoutBody(response: Response): Response {
  return new Response(null, {
    status: response.status,
    headers: response.headers,
  });
}
