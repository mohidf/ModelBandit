/**
 * auth.ts — Better Auth, backed by the same Postgres database as everything else.
 *
 * Email and password only. Sessions are cookies, so the browser sends them
 * automatically and the backend looks them up with auth.api.getSession().
 * All of Better Auth's own routes are served under /auth (see index.ts).
 */

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { getDb, schema } from '../db';

const allowedOrigin = process.env.ALLOWED_ORIGIN ?? 'http://localhost:5173';

export const auth = betterAuth({
  appName:  'ModelRouter',
  baseURL:  process.env.BETTER_AUTH_URL ?? `http://localhost:${process.env.PORT ?? '3000'}`,
  basePath: '/auth',
  secret:   process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(getDb(), { provider: 'pg', schema }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  trustedOrigins: [allowedOrigin],
});

export type Auth = typeof auth;
