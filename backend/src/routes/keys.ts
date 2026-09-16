/**
 * keys.ts
 *
 * GET    /keys           — which providers the user has a key for (never the keys)
 * POST   /keys           — save or replace a key for a provider
 * DELETE /keys/:provider — remove a key
 *
 * All three require a session.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { listKeyProviders, upsertKey, deleteKey } from '../services/userKeyService';

const router = Router();

const VALID_PROVIDERS = new Set(['openai', 'anthropic', 'together', 'google', 'cohere']);
const API_KEY_MIN_LENGTH = 8;
const MASKED_KEY = '••••••••••••';

function isValidProvider(value: unknown): value is string {
  return typeof value === 'string' && VALID_PROVIDERS.has(value);
}

function isValidApiKey(value: unknown): value is string {
  return typeof value === 'string' && value.length >= API_KEY_MIN_LENGTH;
}

function invalidProvider(res: Response): void {
  res.status(400).json({ error: `Invalid provider. Must be one of: ${[...VALID_PROVIDERS].join(', ')}.` });
}

router.get('/', requireAuth, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const rows = await listKeyProviders(req.userId as string);
    res.status(200).json({
      keys: rows.map(r => ({ provider: r.provider, maskedKey: MASKED_KEY, updatedAt: r.updatedAt.toISOString() })),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireAuth, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const { provider, apiKey } = req.body ?? {};

  if (!isValidProvider(provider)) { invalidProvider(res); return; }
  if (!isValidApiKey(apiKey)) {
    res.status(400).json({ error: `Invalid apiKey. Must be a string of at least ${API_KEY_MIN_LENGTH} characters.` });
    return;
  }

  try {
    await upsertKey(req.userId as string, provider, apiKey);
    res.status(200).json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/:provider', requireAuth, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const { provider } = req.params;
  if (!isValidProvider(provider)) { invalidProvider(res); return; }

  try {
    await deleteKey(req.userId as string, provider);
    res.status(200).json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
