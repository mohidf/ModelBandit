import 'dotenv/config';
import { existsSync } from 'fs';
import { resolve } from 'path';
import cors from 'cors';
import express from 'express';
import { config, validateRequiredEnv } from './config';
import { requestLogger } from './middleware/requestLogger';
import { errorHandler } from './middleware/errorHandler';
import { RateLimiter, createRateLimiterMiddleware } from './middleware/rateLimiter';
import routeRouter      from './routes/route';
import metricsRouter    from './routes/metrics';
import performanceRouter from './routes/performance';
import keysRouter        from './routes/keys';
import historyRouter     from './routes/history';
import { logger } from './utils/logger';
import { hybridClassifier } from './services/hybridClassifier';
import { toNodeHandler } from 'better-auth/node';
import { auth } from './lib/auth';

const app = express();

// Trust the first proxy hop so req.ip returns the real client address
// when the server runs behind a load balancer or reverse proxy (e.g. nginx,
// Render, Railway, Fly.io). Without this, all requests appear to come from
// the proxy IP and per-client rate limiting is useless.
app.set('trust proxy', 1);

// --- Middleware ---
// credentials: true so the browser sends the session cookie cross-origin in production.
app.use(cors({ origin: process.env.ALLOWED_ORIGIN ?? 'http://localhost:5173', credentials: true }));

// Better Auth reads the request body itself, so it must be mounted before express.json().
app.all('/auth/*', toNodeHandler(auth));

app.use(express.json({ limit: config.bodyLimit }));
app.use(requestLogger);

// --- Rate limiters ---
const rateLimiter  = new RateLimiter(config.rateLimitPerHour, 60 * 60 * 1000);
const metaLimiter  = new RateLimiter(200,                     60 * 60 * 1000);

// Periodically prune expired rate-limiter entries to prevent unbounded Map growth.
// Each unique IP that ever made a request occupies one entry; without pruning,
// a traffic spike from many IPs leaves stale entries indefinitely.
const PRUNE_INTERVAL_MS = 10 * 60 * 1_000; // every 10 minutes
setInterval(() => {
  rateLimiter.prune();
  metaLimiter.prune();
}, PRUNE_INTERVAL_MS).unref(); // .unref() so this interval does not keep the process alive

// --- Routes ---
app.use('/route',       createRateLimiterMiddleware(rateLimiter),  routeRouter);
app.use('/metrics',     createRateLimiterMiddleware(metaLimiter),  metricsRouter);
app.use('/performance', createRateLimiterMiddleware(metaLimiter),  performanceRouter);
app.use('/keys',        createRateLimiterMiddleware(metaLimiter),  keysRouter);
app.use('/history',     createRateLimiterMiddleware(metaLimiter),  historyRouter);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// --- Built frontend (production) ---
// When frontend/dist exists next to the backend (the Docker image builds it
// there), serve it from the same origin so the session cookie needs no
// cross-site configuration. Any GET that isn't an API route gets index.html
// and the React router takes it from there.
const API_PREFIXES = ['/route', '/metrics', '/performance', '/keys', '/history', '/auth', '/health'];
const frontendDist = process.env.FRONTEND_DIST ?? resolve(__dirname, '../../frontend/dist');
if (existsSync(frontendDist)) {
  app.use(express.static(frontendDist, { index: false, maxAge: '1h' }));
  app.get('*', (req, res, next) => {
    if (API_PREFIXES.some(p => req.path === p || req.path.startsWith(p + '/'))) return next();
    res.sendFile(resolve(frontendDist, 'index.html'));
  });
  logger.info('Serving frontend', { from: frontendDist });
}

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// Global error handler — must be last
app.use(errorHandler);

// --- Process-level safety nets ---
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason: String(reason) });
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { message: err.message, stack: err.stack });
  process.exit(1);
});

// --- Validate required env vars before binding ---
validateRequiredEnv();

// --- Start ---
app.listen(config.port, () => {
  logger.info('ModelBandit backend running', {
    port: config.port,
    env: process.env.NODE_ENV ?? 'development',
    confidenceThreshold: config.confidenceThreshold,
    defaultMaxTokens: config.defaultMaxTokens,
    rateLimitPerHour: config.rateLimitPerHour,
  });

  // Warn early if the embedding classifier will silently fall back to rule-based.
  if (!process.env.OPENAI_API_KEY) {
    logger.warn(
      'OPENAI_API_KEY is not set — embedding classifier disabled, ' +
      'classification will use rule-based fallback only',
    );
  }

  // Pre-compute anchor embeddings in the background so the first routed
  // request does not pay initialisation latency. Failure is non-fatal —
  // HybridClassifier falls back to rule-based on any embedding error.
  (hybridClassifier as { warmUp?: () => Promise<void> }).warmUp?.()
    .catch(err => logger.warn('Embedding warm-up failed (non-fatal)', { err: String(err) }));
});

export default app;
