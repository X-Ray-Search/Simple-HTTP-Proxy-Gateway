import { z } from "zod";

const FetchConfigSchema = z.object({
  url: z.string().url("Invalid target URL format"),
  returnFormat: z.enum(["raw", "json"]).optional().default("raw"),
  init: z.object({
    method: z.string().optional().default("GET"),
    headers: z.record(z.string()).optional().default({}),
    body: z.string().optional(),
    bodyEncoding: z.enum(["text", "base64"]).optional().default("text"),
    redirect: z.enum(["follow", "error", "manual"]).optional().default("manual"),
    cf: z.any().optional(),
  }).optional().default({}),
});

export async function handleRequest(request: Request, env: { PROXY_AUTH_TOKEN?: string }): Promise<Response> {
  console.log(request.method, request.url);
  const authToken = env.PROXY_AUTH_TOKEN;
  if (!authToken) {
    return new Response("Server configuration error: PROXY_AUTH_TOKEN is not set", { status: 500 });
  }

  // Check Proxy-Authorization or Authorization header
  const authHeader = request.headers.get("Proxy-Authorization") || request.headers.get("Authorization");
  
  if (!authHeader) {
    return new Response("Proxy Authentication Required", {
      status: 407,
      headers: {
        "Proxy-Authenticate": 'Basic realm="Proxy"',
      },
    });
  }

  const base64Credentials = authHeader.split(" ")[1];
  if (!base64Credentials) {
    return new Response("Invalid Authentication", { status: 401 });
  }

  try {
    const decodedCredentials = atob(base64Credentials);
    const [username, password] = decodedCredentials.split(":");

    if (username !== "x-ray" || password !== authToken) {
      return new Response("Forbidden: Invalid credentials", { status: 403 });
    }
  } catch (e) {
    return new Response("Invalid Authentication Format", { status: 400 });
  }

  if (request.method === "CONNECT") {
    return new Response("CONNECT method is not supported", { status: 400 });
  }

  let url: URL;
  try {
    url = new URL(request.url);
  } catch (e) {
    return new Response("Invalid URL format", { status: 400 });
  }

  // --- NEW JSON RPC MODE ---
  if (request.method === "POST" && url.pathname === "/v1/fetch") {
    try {
      const rawJson = await request.json().catch(() => null);
      if (!rawJson) {
        return new Response(JSON.stringify({ error: "Invalid or missing JSON payload" }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }

      const parsed = FetchConfigSchema.safeParse(rawJson);
      if (!parsed.success) {
        return new Response(JSON.stringify({ 
          error: "Validation failed", 
          issues: parsed.error.issues 
        }), { 
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }

      const config = parsed.data;

      let fetchBody: BodyInit | null = null;
      if (config.init.body) {
        if (config.init.bodyEncoding === "base64") {
          const binaryString = atob(config.init.body);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          fetchBody = bytes.buffer;
        } else {
          fetchBody = config.init.body;
        }
      }

      const proxyRequest = new Request(config.url, {
        method: config.init.method,
        headers: config.init.headers,
        body: fetchBody,
        redirect: config.init.redirect,
        // @ts-ignore Cloudflare specific fetch options
        cf: config.init.cf,
      });

      const response = await fetch(proxyRequest);

      if (config.returnFormat === "json") {
        const responseBuffer = await response.arrayBuffer();
        const base64Body = btoa(String.fromCharCode(...new Uint8Array(responseBuffer)));
        const headersRecord: Record<string, string> = {};
        response.headers.forEach((val, key) => { headersRecord[key] = val; });

        return new Response(JSON.stringify({
          status: response.status,
          statusText: response.statusText,
          headers: headersRecord,
          url: response.url,
          redirected: response.redirected,
          bodyBase64: base64Body
        }), {
          headers: { "Content-Type": "application/json" }
        });
      } else {
        const responseHeaders = new Headers(response.headers);
        // Leave headers largely transparent, just copy them over
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
        });
      }
    } catch (e: any) {
      return new Response(`Error processing JSON payload: ${e.message}`, { status: 400 });
    }
  }
  // --- END JSON RPC MODE ---

  let targetUrlStr = request.url;
  
  // Gateway mode support: if the request URL is pointing to the proxy itself,
  // try to use a "url" query parameter, or extract the path if it's a URL.
  if (url.searchParams.has("url")) {
    targetUrlStr = url.searchParams.get("url")!;
  } else if (url.pathname.startsWith("/http")) {
    targetUrlStr = url.pathname.slice(1) + url.search;
  }
  
  // Validate target URL
  let targetUrl: URL;
  try {
    targetUrl = new URL(targetUrlStr);
  } catch (e) {
    return new Response("Invalid target URL", { status: 400 });
  }

  const proxyRequest = new Request(targetUrl.toString(), {
    method: request.method,
    headers: new Headers(request.headers),
    body: request.body,
    redirect: "manual",
  });

  // Remove hop-by-hop headers
  proxyRequest.headers.delete("Proxy-Authorization");
  proxyRequest.headers.delete("Host");

  try {
    const response = await fetch(proxyRequest);
    const responseHeaders = new Headers(response.headers);
    // Allow CORS if needed, or leave transparent
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    return new Response(`Bad Gateway: ${error}`, { status: 502 });
  }
}
