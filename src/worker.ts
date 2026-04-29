import { handleRequest } from "./proxy.ts";

export interface Env {
  PROXY_AUTH_TOKEN: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request, env);
  },
};
