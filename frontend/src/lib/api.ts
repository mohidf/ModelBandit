/**
 * Where the backend lives. In dev this is the /api prefix that Vite proxies to
 * localhost:3000. In production set VITE_API_URL to the backend's public URL.
 */
export const API_BASE: string = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || '/api';

/** fetch() against the backend. The session cookie goes along automatically. */
export async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'include' });
}
