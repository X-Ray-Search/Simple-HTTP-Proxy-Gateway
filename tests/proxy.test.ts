import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { handleRequest } from "../src/proxy.ts";

describe("HTTP Proxy Gateway", () => {
  let targetServer: any;
  let targetUrl: string;

  beforeAll(() => {
    // Spin up a simple target server to mock the destination
    targetServer = Bun.serve({
      port: 0, // OS assigns a free port
      fetch(req) {
        if (req.url.endsWith("/hello")) {
          return new Response("world", { status: 200, headers: { "X-Test-Header": "success" } });
        }
        return new Response("Not found", { status: 404 });
      },
    });
    targetUrl = `http://localhost:${targetServer.port}`;
  });

  afterAll(() => {
    if (targetServer) {
      targetServer.stop(true);
    }
  });

  it("should return 500 if PROXY_AUTH_TOKEN is missing in env", async () => {
    const req = new Request(`${targetUrl}/hello`);
    const res = await handleRequest(req, {});
    expect(res.status).toBe(500);
    expect(await res.text()).toContain("PROXY_AUTH_TOKEN is not set");
  });

  it("should return 407 Proxy Authentication Required if no auth header is provided", async () => {
    const req = new Request(`${targetUrl}/hello`);
    const res = await handleRequest(req, { PROXY_AUTH_TOKEN: "secret" });
    
    expect(res.status).toBe(407);
    expect(res.headers.get("Proxy-Authenticate")).toBe('Basic realm="Proxy"');
  });

  it("should return 401 if auth format is completely invalid", async () => {
    const req = new Request(`${targetUrl}/hello`, {
      headers: {
        "Proxy-Authorization": "Bearer invalidtoken" // Invalid scheme for this proxy
      }
    });
    const res = await handleRequest(req, { PROXY_AUTH_TOKEN: "secret" });
    
    // Our proxy expects "Basic <base64>", splitting by space. If it doesn't decode, it fails.
    // If we pass "Bearer xyz", splitting gives "xyz", which atob might fail on or decode wrong.
    // Let's test a totally malformed one
    const req2 = new Request(`${targetUrl}/hello`, {
      headers: { "Proxy-Authorization": "Basic " } // missing base64 part
    });
    const res2 = await handleRequest(req2, { PROXY_AUTH_TOKEN: "secret" });
    expect(res2.status).toBe(401);
  });

  it("should return 403 Forbidden for wrong username", async () => {
    const wrongAuth = btoa("wronguser:secret");
    const req = new Request(`${targetUrl}/hello`, {
      headers: { "Proxy-Authorization": `Basic ${wrongAuth}` }
    });
    const res = await handleRequest(req, { PROXY_AUTH_TOKEN: "secret" });
    
    expect(res.status).toBe(403);
  });

  it("should return 403 Forbidden for wrong password", async () => {
    const wrongAuth = btoa("x-ray:wrongsecret");
    const req = new Request(`${targetUrl}/hello`, {
      headers: { "Proxy-Authorization": `Basic ${wrongAuth}` }
    });
    const res = await handleRequest(req, { PROXY_AUTH_TOKEN: "secret" });
    
    expect(res.status).toBe(403);
  });

  it("should successfully proxy the request with valid Proxy-Authorization", async () => {
    const validAuth = btoa("x-ray:secret");
    const req = new Request(`${targetUrl}/hello`, {
      method: "GET",
      headers: { 
        "Proxy-Authorization": `Basic ${validAuth}`,
        "X-Custom-Client-Header": "test-value"
      }
    });
    
    const res = await handleRequest(req, { PROXY_AUTH_TOKEN: "secret" });
    
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("world");
    expect(res.headers.get("X-Test-Header")).toBe("success");
  });

  it("should successfully proxy the request with valid Authorization header (fallback)", async () => {
    const validAuth = btoa("x-ray:secret");
    const req = new Request(`${targetUrl}/hello`, {
      method: "GET",
      headers: { 
        "Authorization": `Basic ${validAuth}`
      }
    });
    
    const res = await handleRequest(req, { PROXY_AUTH_TOKEN: "secret" });
    
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("world");
  });
});
