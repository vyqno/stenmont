import { createApp } from "./index";

type Env = { API_URL: string; APP_URL: string };
export default {
  fetch: (req: Request, env: Env) => createApp({ apiUrl: env.API_URL, appUrl: env.APP_URL, fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(10000) }) }).fetch(req),
};
