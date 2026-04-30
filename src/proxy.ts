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

  let targetUrlStr = request.url;
  let url: URL;
  
  try {
    url = new URL(request.url);
  } catch (e) {
    return new Response("Invalid URL format", { status: 400 });
  }

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
