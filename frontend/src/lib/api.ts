/**
 * Where the backend lives. In dev it's the /api prefix that Vite proxies to
 * localhost:3000. When the backend serves the built frontend itself (the
 * Docker image), VITE_API_URL is set to an empty string at build time and
 * requests go to the same origin. A full URL also works.
 */
const raw = import.meta.env.VITE_API_URL as string | undefined;
export const API_BASE: string = raw === undefined ? '/api' : raw.replace(/\/$/, '');

/** fetch() against the backend. The session cookie goes along automatically. */
export async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'include' });
}
