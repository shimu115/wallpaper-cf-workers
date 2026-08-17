import { DEFAULT_CONTENT_TYPE, TIMEOUT_MS } from "./config";

/** 带状态的代理错误，最终映射为对应 HTTP 状态码返回给客户端。 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/**
 * 请求 wallpaper-api 获取图片直链（url 模式）。
 */
export async function fetchImageUrl(
  apiBaseUrl: string,
  upstreamPath: string,
  userAgent: string,
): Promise<string> {
  const base = apiBaseUrl.replace(/\/+$/, "");
  const apiUrl = `${base}${upstreamPath}?askMethod=url`;

  const res = await fetchWithTimeout(
    apiUrl,
    { headers: { "User-Agent": userAgent } },
    TIMEOUT_MS,
    "wallpaper-api",
  );

  if (!res.ok) {
    throw new HttpError(502, "wallpaper-api 请求失败");
  }

  const imageUrl = (await res.text()).trim();
  if (!imageUrl) {
    throw new HttpError(502, "wallpaper-api 返回空图片 URL");
  }

  return imageUrl;
}

/**
 * 校验并请求图片源站，返回图片响应流。
 */
export async function fetchImage(rawUrl: string, userAgent: string): Promise<Response> {
  const url = validateImageUrl(rawUrl);

  const res = await fetchWithTimeout(
    url.toString(),
    {
      headers: { "User-Agent": userAgent },
      redirect: "follow",
    },
    TIMEOUT_MS,
    "图片源站",
  );

  if (!res.ok) {
    throw new HttpError(502, "图片源站请求失败");
  }

  return res;
}

/**
 * 依据图片源站响应构造最终返回给客户端的 Response。
 * 只透传白名单响应头，Cache-Control 由 Worker 自己控制（不继承源站）。
 */
export function buildImageResponse(imageResponse: Response, ttl: number): Response {
  const headers = new Headers();

  const contentType = imageResponse.headers.get("Content-Type") || DEFAULT_CONTENT_TYPE;
  headers.set("Content-Type", contentType);

  copyHeader(imageResponse.headers, headers, "Content-Length");
  copyHeader(imageResponse.headers, headers, "ETag");
  copyHeader(imageResponse.headers, headers, "Last-Modified");

  headers.set("Cache-Control", `public, max-age=${ttl}`);

  return new Response(imageResponse.body, {
    status: imageResponse.status,
    headers,
  });
}

/* ------------------------------------------------------------------ */
/* 内部工具函数                                                          */
/* ------------------------------------------------------------------ */

function copyHeader(from: Headers, to: Headers, name: string): void {
  const value = from.get(name);
  if (value !== null) {
    to.set(name, value);
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  label: string,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    if (controller.signal.aborted) {
      throw new HttpError(502, `${label}请求超时`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 校验图片 URL：必须为 http/https，且拒绝明显的内网目标（防 SSRF）。
 */
export function validateImageUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new HttpError(502, "图片 URL 非法");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new HttpError(502, "图片 URL 协议非法");
  }

  if (isPrivateHost(url.hostname)) {
    throw new HttpError(502, "拒绝访问内网图片 URL");
  }

  return url;
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (host === "localhost" || host.endsWith(".localhost")) {
    return true;
  }

  if (isIPv4(host)) {
    return isPrivateIPv4(host);
  }

  if (host.includes(":")) {
    return isPrivateIPv6(host);
  }

  return false;
}

function isIPv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

function isPrivateIPv4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  if (a === 0) return true; // 0.0.0.0/8 本网络
  if (a === 10) return true; // 10.0.0.0/8 私有
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 运营商级 NAT
  if (a === 127) return true; // 127.0.0.0/8 回环
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 链路本地
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 私有
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 私有
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  if (ip === "::" || ip === "::1") return true;

  // IPv4-mapped：::ffff:a.b.c.d
  const mapped = ip.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isPrivateIPv4(mapped[1]);

  const lower = ip.toLowerCase();
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7 唯一本地
  // fe80::/10 链路本地（fe80 - febf）
  if (lower.startsWith("fe8") || lower.startsWith("fe9") ||
      lower.startsWith("fea") || lower.startsWith("feb")) return true;
  return false;
}
