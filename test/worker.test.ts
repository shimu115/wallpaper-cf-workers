import { describe, it, expect, vi, afterEach } from "vitest";
import worker from "../src/index";

const ENV = { API_BASE_URL: "https://api.example.com" };

function makeCtx() {
  return { waitUntil: vi.fn((p: Promise<unknown>) => p) } as any;
}

function getRequest(path: string, init: RequestInit = {}) {
  return new Request(`https://img.example.com${path}`, {
    ...init,
    headers: { "User-Agent": "test-agent", ...(init.headers as Record<string, string> | undefined) },
  });
}

function stubCaches(
  overrides: {
    match?: (key: string) => Promise<Response | undefined>;
    put?: () => Promise<void>;
  } = {},
) {
  const cache = {
    match: vi.fn(overrides.match ?? (() => Promise.resolve(undefined))),
    put: vi.fn(overrides.put ?? (() => Promise.resolve())),
  };
  vi.stubGlobal("caches", { default: cache });
  return cache;
}

function stubUpstreamFetch() {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = typeof input === "string" ? input : String(input);
    if (url.includes("askMethod=url")) {
      return new Response("https://cdn.example.com/pic.jpg", {
        status: 200,
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
      });
    }
    return new Response("fake-image-bytes", {
      status: 200,
      headers: { "Content-Type": "image/jpeg" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("wallpaper-cf-workers 主流程", () => {
  it("缓存未命中：取直链 → 代理图片 → 写缓存，返回 max-age=3600", async () => {
    const cache = stubCaches();
    const fetchMock = stubUpstreamFetch();
    const ctx = makeCtx();

    const res = await worker.fetch(getRequest("/bing/today"), ENV, ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(await res.text()).toBe("fake-image-bytes");

    expect(fetchMock).toHaveBeenCalledTimes(2); // wallpaper-api + 图片源站
    expect(cache.put).toHaveBeenCalledTimes(1);
    expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
  });

  it("缓存命中：直接返回缓存，不再请求上游", async () => {
    const cached = new Response("cached-bytes", {
      status: 200,
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=3600" },
    });
    const cache = stubCaches({ match: () => Promise.resolve(cached) });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const ctx = makeCtx();

    const res = await worker.fetch(getRequest("/bing/today"), ENV, ctx);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("cached-bytes");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("random 路由使用 60 秒 TTL", async () => {
    stubCaches();
    stubUpstreamFetch();
    const ctx = makeCtx();

    const res = await worker.fetch(getRequest("/acg/random"), ENV, ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60");
  });

  it("HEAD 请求：复用 GET 逻辑但不返回 body", async () => {
    const cached = new Response("cached-bytes", {
      status: 200,
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=3600" },
    });
    stubCaches({ match: () => Promise.resolve(cached) });
    vi.stubGlobal("fetch", vi.fn());
    const ctx = makeCtx();

    const res = await worker.fetch(getRequest("/bing/today", { method: "HEAD" }), ENV, ctx);

    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
  });

  it("未知路由返回 404", async () => {
    stubCaches();
    vi.stubGlobal("fetch", vi.fn());

    const res = await worker.fetch(getRequest("/nope"), ENV, makeCtx());

    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not Found");
  });

  it("非 GET/HEAD 方法返回 405", async () => {
    const res = await worker.fetch(getRequest("/bing/today", { method: "POST" }), ENV, makeCtx());

    expect(res.status).toBe(405);
    expect(await res.text()).toBe("Method Not Allowed");
  });

  it("wallpaper-api 返回空 URL 时返回 502", async () => {
    stubCaches();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("  ", {
        status: 200,
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
      })),
    );

    const res = await worker.fetch(getRequest("/bing/today"), ENV, makeCtx());

    expect(res.status).toBe(502);
  });

  it("图片 URL 指向内网时返回 502（防 SSRF）", async () => {
    stubCaches();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = typeof input === "string" ? input : String(input);
        if (url.includes("askMethod=url")) {
          return new Response("http://127.0.0.1/secret.jpg", {
            status: 200,
            headers: { "Content-Type": "text/plain;charset=UTF-8" },
          });
        }
        throw new Error("不应请求内网地址");
      }),
    );

    const res = await worker.fetch(getRequest("/bing/today"), ENV, makeCtx());

    expect(res.status).toBe(502);
    expect(await res.text()).toBe("拒绝访问内网图片 URL");
  });
});
