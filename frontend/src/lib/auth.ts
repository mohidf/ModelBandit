import { createAuthClient } from 'better-auth/react';
import { API_BASE } from './api';

/**
 * Better Auth client. Sessions are cookies, so nothing is stored in the
 * browser by hand. The server mounts its auth routes at <backend>/auth,
 * which in dev is reached through the Vite proxy as /api/auth.
 */
export const authClient = createAuthClient({
  baseURL: `${API_BASE.startsWith('http') ? API_BASE : window.location.origin + API_BASE}/auth`,
  fetchOptions: { credentials: 'include' },
});

export const { useSession, signIn, signUp, signOut } = authClient;
