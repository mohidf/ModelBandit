/**
 * history.ts
 *
 * GET    /history — the signed-in user's last 20 entries, newest first
 * POST   /history — save an entry
 * DELETE /history — clear everything
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { listHistory, addHistory, clearHistory, type HistoryRow } from '../services/historyStore';

const router = Router();

function toJson(row: HistoryRow) {
  return { id: row.id, prompt: row.prompt, result: row.result, created_at: row.createdAt.toISOString() };
}

router.get('/', requireAuth, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const rows = await listHistory(req.userId as string);
    res.json({ history: rows.map(toJson) });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireAuth, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const { prompt, result } = req.body ?? {};
  if (!prompt || typeof prompt !== 'string' || !result || typeof result !== 'object') {
    res.status(400).json({ error: 'prompt and result are required.' });
    return;
  }

  try {
    const entry = await addHistory(req.userId as string, prompt, result);
    res.status(201).json({ entry: toJson(entry) });
  } catch (err) {
    next(err);
  }
});

router.delete('/', requireAuth, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    await clearHistory(req.userId as string);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
