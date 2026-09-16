import { Router, type Request, type Response, type NextFunction } from 'express';
import { routingEngine } from '../services/router';
import { requireAuth } from '../middleware/auth';
import { getUserApiKeys } from '../services/userKeyService';
import { config } from '../config';

const router = Router();



// ---------------------------------------------------------------------------
// POST /route
// ---------------------------------------------------------------------------

router.post('/', requireAuth, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const { prompt, maxTokens, preferCost, optimizationMode, customWeights } = req.body ?? {};

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    res.status(400).json({ error: '`prompt` is required and must be a non-empty string.' });
    return;
  }

  const MAX_PROMPT_CHARS = 20_000;
  if (prompt.length > MAX_PROMPT_CHARS) {
    res.status(400).json({ error: `Prompt must be at most ${MAX_PROMPT_CHARS} characters.` });
    return;
  }

  const MAX_TOKENS_CEILING = 32_000;
  const validatedMaxTokens =
    typeof maxTokens === 'number' && maxTokens > 0
      ? Math.min(Math.floor(maxTokens), MAX_TOKENS_CEILING)
      : config.defaultMaxTokens;

  const userApiKeys = await getUserApiKeys(req.userId!);
  const hasUserKeys = Object.keys(userApiKeys).length > 0;

  // A user with no saved key routes on the server's own OpenRouter key.
  // With neither there is nothing to call with.
  if (!hasUserKeys && !process.env.OPENROUTER_API_KEY) {
    res.status(403).json({
      error:   'NO_KEYS',
      message: 'You have not added an API key. Go to Settings to add your OpenRouter key.',
    });
    return;
  }

  try {
    const result = await routingEngine.route({
      prompt,
      maxTokens: validatedMaxTokens,
      preferCost,
      optimizationMode,
      customWeights,
      userApiKeys,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
