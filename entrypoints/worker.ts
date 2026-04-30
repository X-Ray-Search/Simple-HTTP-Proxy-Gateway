import { handleRequest } from "../src/proxy.ts";

export interface Env {
  PROXY_AUTH_TOKEN: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};
