export async function handleRequest(request: Request, env: { PROXY_AUTH_TOKEN?: string }): Promise<Response> {
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

  const url = new URL(request.url);
  
  // If request is made directly to the proxy without a full URL (e.g. gateway mode)
  // we might need to rely on a query parameter or custom header if it's acting as a fetcher.
  // Assuming it acts as a forward proxy, `request.url` will be the destination.
  
  const proxyRequest = new Request(request.url, {
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
