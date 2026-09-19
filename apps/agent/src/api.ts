import { loadEnv } from "@pera/core";

/** Thin client for the Pera API so every agent action is mirrored on the dashboard event stream. */
export function api() {
  const env = loadEnv();
  const base = env.PUBLIC_API_URL.replace(/\/$/, "");
  const headers = { "content-type": "application/json", authorization: `Bearer ${env.API_BEARER_TOKEN}` };
  async function handle<T>(res: Response): Promise<T> {
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* keep text */
    }
    if (!res.ok) {
      const err = new Error(`${res.status} ${(body as { error?: string })?.error ?? text}`) as Error & { status: number; body: unknown };
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body as T;
  }
  return {
    base,
    get: async <T>(path: string) => handle<T>(await fetch(`${base}${path}`, { headers })),
    post: async <T>(path: string, body: unknown) => handle<T>(await fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body ?? {}) })),
  };
}
