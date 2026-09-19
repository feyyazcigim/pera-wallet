export const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3000";
export const RS_URL = (import.meta.env.VITE_RESOURCE_SERVER_URL as string | undefined) ?? "http://localhost:4000";

export function token(): string | null {
  return localStorage.getItem("pera.session");
}
export function setToken(t: string | null): void {
  if (t) localStorage.setItem("pera.session", t);
  else localStorage.removeItem("pera.session");
}

export async function api<T>(path: string, body?: unknown, method = body ? "POST" : "GET"): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const t = token();
  if (t) headers.authorization = `Bearer ${t}`;
  const res = await fetch(`${API_URL}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text);
  } catch {
    /* text */
  }
  if (!res.ok) throw Object.assign(new Error(`${res.status} ${(json as { error?: string })?.error ?? text}`), { status: res.status, body: json });
  return json as T;
}
