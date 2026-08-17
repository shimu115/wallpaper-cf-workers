import { describe, it, expect } from "vitest";
import { buildImageResponse, validateImageUrl, HttpError } from "../src/proxy";

describe("validateImageUrl（防 SSRF）", () => {
  it("接受公网 http/https URL", () => {
    expect(validateImageUrl("https://www.bing.com/th?id=123").toString()).toBe(
      "https://www.bing.com/th?id=123",
    );
    expect(validateImageUrl("http://example.com/pic.jpg").hostname).toBe("example.com");
  });

  it("拒绝非 http/https 协议", () => {
    expect(() => validateImageUrl("ftp://example.com/pic.jpg")).toThrow(HttpError);
  });

  it("拒绝非法 URL", () => {
    expect(() => validateImageUrl("not a url")).toThrow(HttpError);
  });

  it.each([
    "http://127.0.0.1/pic.jpg",
    "http://10.0.0.1/pic.jpg",
    "http://172.16.0.1/pic.jpg",
    "http://192.168.1.1/pic.jpg",
    "http://169.254.169.254/pic.jpg",
    "http://localhost/pic.jpg",
    "http://[::1]/pic.jpg",
    "http://[fd00::1]/pic.jpg",
  ])("拒绝内网目标 %s", (url) => {
    expect(() => validateImageUrl(url)).toThrow(HttpError);
  });
});

describe("buildImageResponse", () => {
  it("透传白名单响应头并覆盖 Cache-Control", async () => {
    const source = new Response("image-bytes", {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "ETag": '"etag-1"',
        "Last-Modified": "Mon, 21 Jul 2025 12:14:57 GMT",
        "Cache-Control": "no-cache", // 应被 Worker 覆盖
        "Set-Cookie": "session=abc", // 不应透传（避免影响缓存）
      },
    });

    const result = buildImageResponse(source, 60);

    expect(result.status).toBe(200);
    expect(result.headers.get("Content-Type")).toBe("image/png");
    expect(result.headers.get("ETag")).toBe('"etag-1"');
    expect(result.headers.get("Last-Modified")).toBe("Mon, 21 Jul 2025 12:14:57 GMT");
    expect(result.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(result.headers.get("Set-Cookie")).toBeNull();
    expect(await result.text()).toBe("image-bytes");
  });

  it("源站缺少 Content-Type 时使用默认 image/jpeg", () => {
    // 用字节流 body，避免 Node 对字符串 body 自动补 Content-Type
    const source = new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    const result = buildImageResponse(source, 3600);
    expect(result.headers.get("Content-Type")).toBe("image/jpeg");
  });
});
