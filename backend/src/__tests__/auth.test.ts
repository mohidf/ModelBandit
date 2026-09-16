/**
 * auth.test.ts
 *
 * Tests for the auth middleware. Better Auth's session lookup is mocked, so
 * no database is touched.
 */

import type { Request, Response, NextFunction } from 'express';

const mockGetSession = jest.fn();

jest.mock('../lib/auth', () => ({
  auth: { api: { getSession: mockGetSession } },
}));

// better-auth/node is ESM-only, which Jest's CommonJS runtime can't load.
jest.mock('better-auth/node', () => ({
  fromNodeHeaders: (h: Record<string, string>) => new Headers(h),
}));

import { optionalAuth, requireAuth } from '../middleware/auth';

function makeReq(cookie?: string): Request {
  return { headers: cookie ? { cookie } : {} } as unknown as Request;
}

function makeRes(): Response {
  return {
    status: jest.fn().mockReturnThis(),
    json:   jest.fn().mockReturnThis(),
  } as unknown as Response;
}

const next: NextFunction = jest.fn();

type ReqWithUser = Request & { userId?: string };

describe('optionalAuth', () => {
  beforeEach(() => jest.clearAllMocks());

  it('passes through with no userId when there is no session', async () => {
    mockGetSession.mockResolvedValueOnce(null);
    const req = makeReq();

    await optionalAuth(req, makeRes(), next);

    expect(next).toHaveBeenCalledWith();
    expect((req as ReqWithUser).userId).toBeUndefined();
  });

  it('attaches userId when the session is valid', async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: 'user-123' }, session: { id: 's1' } });
    const req = makeReq('better-auth.session_token=abc');

    await optionalAuth(req, makeRes(), next);

    expect(mockGetSession).toHaveBeenCalledTimes(1);
    expect((req as ReqWithUser).userId).toBe('user-123');
    expect(next).toHaveBeenCalledWith();
  });

  it('passes through when the session lookup throws', async () => {
    mockGetSession.mockRejectedValueOnce(new Error('db down'));
    const req = makeReq('better-auth.session_token=abc');

    await optionalAuth(req, makeRes(), next);

    expect(next).toHaveBeenCalledWith();
    expect((req as ReqWithUser).userId).toBeUndefined();
  });
});

describe('requireAuth', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 401 when there is no session', async () => {
    mockGetSession.mockResolvedValueOnce(null);
    const res = makeRes();

    await requireAuth(makeReq(), res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required.' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when the session has no user', async () => {
    mockGetSession.mockResolvedValueOnce({ user: null, session: null });
    const res = makeRes();

    await requireAuth(makeReq('better-auth.session_token=expired'), res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('attaches userId and calls next for a valid session', async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: 'user-abc' }, session: { id: 's1' } });
    const req = makeReq('better-auth.session_token=abc');
    const res = makeRes();

    await requireAuth(req, res, next);

    expect((req as ReqWithUser).userId).toBe('user-abc');
    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 401 when the session lookup throws', async () => {
    mockGetSession.mockRejectedValueOnce(new Error('db down'));
    const res = makeRes();

    await requireAuth(makeReq('better-auth.session_token=abc'), res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
