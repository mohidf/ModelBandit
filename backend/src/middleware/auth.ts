/**
 * auth.ts
 *
 * Express middleware that resolves the Better Auth session cookie to a user ID.
 *
 * - optionalAuth: sets req.userId when a valid session is present, and never
 *   blocks the request.
 * - requireAuth: same lookup, but answers 401 when there is no valid session.
 */

import type { Request, Response, NextFunction } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { auth } from '../lib/auth';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

/** Returns the signed-in user's ID, or null if the request has no valid session. */
async function resolveUserId(req: Request): Promise<string | null> {
  try {
    const result = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    return result?.user?.id ?? null;
  } catch {
    return null;
  }
}

export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const userId = await resolveUserId(req);
  if (userId) req.userId = userId;
  next();
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = await resolveUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  req.userId = userId;
  next();
}
