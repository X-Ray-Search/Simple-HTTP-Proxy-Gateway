import { handleRequest } from "./proxy.ts";

const port = process.env.PORT || 3000;

Bun.serve({
  port,
  async fetch(req) {
    return handleRequest(req, {
      PROXY_AUTH_TOKEN: process.env.PROXY_AUTH_TOKEN,
    });
  },
});

console.log(`Bun proxy server listening on port ${port}`);
