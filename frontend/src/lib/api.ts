import { supabase } from './supabase';

/**
 * fetch() against the backend with the user's Supabase token attached.
 * In dev the /api prefix is proxied to the backend by Vite.
 */
export async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (session?.access_token) headers.set('Authorization', `Bearer ${session.access_token}`);
  return fetch(`/api${path}`, { ...init, headers });
}
