#!/usr/bin/env ts-node
/**
 * benchmark.ts
 *
 * Runs 50 diverse prompts through the live router and measures:
 *   ① Classification accuracy — per-domain, split by easy (keyword-triggered) / hard (semantic)
 *   ② Cost savings vs always using GPT-4o
 *   ③ Latency — average, p50, p95, max, and per-tier breakdown
 *   ④ Escalation rate and strategy mode distribution
 *   ⑤ Model distribution — which models the router actually selected
 *
 * Prerequisites:
 *   - Backend running at http://localhost:3000 (or set $BENCHMARK_URL)
 *   - OPENAI_API_KEY in backend/.env  (embedding classifier; falls back to rule-based without it)
 *   - At least one provider API key (OPENROUTER_API_KEY)
 *   - An account on that backend: BENCHMARK_EMAIL and BENCHMARK_PASSWORD
 *
 * Usage:
 *   cd backend
 *   BENCHMARK_EMAIL=you@example.com BENCHMARK_PASSWORD=... npm run benchmark
 *   BENCHMARK_URL=https://modelbandit.up.railway.app BENCHMARK_EMAIL=... BENCHMARK_PASSWORD=... npm run benchmark
 *
 * Expected runtime: ~3–6 minutes (50 sequential API calls, 500 ms delay between each)
 * Expected cost:    ~$0.01–0.05 (mostly cheap-tier models)
 */

import { TEST_CASES, type Domain, type TestCase } from './benchmarkPrompts';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE_URL      = process.env.BENCHMARK_URL ?? 'http://localhost:3000';
const MAX_TOKENS    = 256;   // short responses — testing routing, not generation quality
const REQUEST_DELAY = 500;   // ms between calls — stays inside the default 50 req/hr rate limit

/**
 * GPT-4o list prices (USD per 1 M tokens, early 2025) used as the
 * "naively use GPT-4o for everything" cost baseline.
 */
const GPT4O_INPUT_PER_1M  = 2.50;
const GPT4O_OUTPUT_PER_1M = 10.00;

// /route requires a signed-in session. The benchmark signs in once as this
// account (create it in the app first) and sends the cookie with every prompt.
const BENCHMARK_EMAIL    = process.env.BENCHMARK_EMAIL;
const BENCHMARK_PASSWORD = process.env.BENCHMARK_PASSWORD;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BenchmarkResult {
  testCase:       TestCase;
  actualDomain:   Domain;
  confidence:     number;
  model:          string;
  tier:           string;
  escalated:      boolean;
  latencyMs:      number;
  actualCostUsd:  number;
  gpt4oCostUsd:   number;
  strategyMode:   string;
  correct:        boolean;
  error?:         string;
}

// Minimal shape we read from the route response
interface RouteResponse {
  classification: { domain: string; confidence: number; estimatedTokens: number };
  finalModel:     { model: string; tier: string };
  escalated:      boolean;
  response:       string;
  latencyMs:      number;
  totalCostUsd:   number;
  strategyMode:   string;
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

/**
 * Sign in through Better Auth and return the session cookie to send with
 * each /route call. The Origin header is the backend's own origin, which
 * Better Auth trusts by default.
 */
async function signIn(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/auth/sign-in/email`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Origin: new URL(BASE_URL).origin },
    body:    JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Sign-in failed with HTTP ${res.status}: ${body.slice(0, 120)}`);
  }

  const cookies = res.headers.getSetCookie().map(c => c.split(';')[0]);
  if (cookies.length === 0) throw new Error('Sign-in succeeded but returned no session cookie');
  return cookies.join('; ');
}

async function routePrompt(prompt: string, sessionCookie: string): Promise<RouteResponse> {
  const res = await fetch(`${BASE_URL}/route`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
    body:    JSON.stringify({ prompt, maxTokens: MAX_TOKENS }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 120)}`);
  }

  return res.json() as Promise<RouteResponse>;
}

// ---------------------------------------------------------------------------
// Cost helper
// ---------------------------------------------------------------------------

/** Estimate what this call would have cost if routed to GPT-4o every time. */
function estimateGpt4oCost(estimatedInputTokens: number, responseText: string): number {
  const outputTokens = Math.ceil(responseText.length / 4);
  return (estimatedInputTokens * GPT4O_INPUT_PER_1M + outputTokens * GPT4O_OUTPUT_PER_1M) / 1_000_000;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function pct(n: number, d: number): string {
  if (d === 0) return '   —  ';
  return `${((n / d) * 100).toFixed(1)}%`;
}

function usd(n: number): string {
  if (n < 0.0001) return `$${(n * 1_000_000).toFixed(1)}µ`; // micro-dollars
  if (n < 0.01)   return `$${n.toFixed(5)}`;
  return `$${n.toFixed(4)}`;
}

function ms(n: number): string {
  return n === 0 ? '  —' : `${Math.round(n)}ms`;
}

function pad(s: string | number, width: number, right = false): string {
  const str = String(s);
  return right ? str.padStart(width) : str.padEnd(width);
}

function hr(char = '─', width = 90): string { return char.repeat(width); }

// ---------------------------------------------------------------------------
// Delay helper
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function checkServer(): Promise<void> {
  try {
    const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(3_000) });
    if (!res.ok) throw new Error(`/health returned HTTP ${res.status}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n  ✗ Cannot reach backend at ${BASE_URL}`);
    console.error(`    ${msg}`);
    console.error('\n  Start the backend first:');
    console.error('    cd backend && npm run dev\n');
    process.exit(1);
  }
}

async function runBenchmark(): Promise<void> {
  console.log('\n' + hr('═'));
  console.log('  ModelBandit benchmark — 50 prompts across 11 domains');
  console.log(`  Target: ${BASE_URL}   Max tokens: ${MAX_TOKENS}   Delay: ${REQUEST_DELAY}ms`);
  console.log('  Columns: [seq] DIFFICULTY domain  ›  prompt (55 chars)  RESULT  latency  cost');
  console.log(hr('═'));
  console.log();

  await checkServer();

  if (!BENCHMARK_EMAIL || !BENCHMARK_PASSWORD) {
    console.error('\n  ✗ /route needs a signed-in session.');
    console.error('    Set BENCHMARK_EMAIL and BENCHMARK_PASSWORD to an account on this backend.\n');
    process.exit(1);
  }
  const sessionCookie = await signIn(BENCHMARK_EMAIL, BENCHMARK_PASSWORD);

  const results: BenchmarkResult[] = [];
  const startTime = Date.now();

  for (let i = 0; i < TEST_CASES.length; i++) {
    const tc  = TEST_CASES[i];
    const idx = String(i + 1).padStart(2, '0');
    const tag = `[${idx}/${TEST_CASES.length}]`;
    const domainLabel = tc.expectedDomain.padEnd(14);

    process.stdout.write(
      `${tag} ${tc.difficulty.toUpperCase().padEnd(4)} ${domainLabel} › ` +
      `${tc.prompt.slice(0, 50).padEnd(50)} `
    );

    try {
      const rr = await routePrompt(tc.prompt, sessionCookie);

      const actualDomain = rr.classification.domain as Domain;
      const correct      = actualDomain === tc.expectedDomain;
      const gpt4oCost    = estimateGpt4oCost(rr.classification.estimatedTokens, rr.response);

      results.push({
        testCase:      tc,
        actualDomain,
        confidence:    rr.classification.confidence,
        model:         rr.finalModel.model,
        tier:          rr.finalModel.tier,
        escalated:     rr.escalated,
        latencyMs:     rr.latencyMs,
        actualCostUsd: rr.totalCostUsd,
        gpt4oCostUsd:  gpt4oCost,
        strategyMode:  rr.strategyMode,
        correct,
      });

      const mark = correct
        ? '✓'
        : `✗→${actualDomain.slice(0, 10)}`;
      process.stdout.write(`${mark.padEnd(14)}  ${String(rr.latencyMs).padStart(6)}ms  ${usd(rr.totalCostUsd)}\n`);

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        testCase: tc, actualDomain: 'general' as Domain, confidence: 0,
        model: '', tier: '', escalated: false, latencyMs: 0,
        actualCostUsd: 0, gpt4oCostUsd: 0, strategyMode: 'error',
        correct: false, error: msg,
      });
      process.stdout.write(`ERROR\n`);
      console.error(`         ↳ ${msg}`);
    }

    if (i < TEST_CASES.length - 1) await sleep(REQUEST_DELAY);
  }

  const wallMs = Date.now() - startTime;
  printSummary(results, wallMs);
}

// ---------------------------------------------------------------------------
// Summary report
// ---------------------------------------------------------------------------

function printSummary(results: BenchmarkResult[], wallMs: number): void {
  const W = 90;

  const ALL_DOMAINS: Domain[] = [
    'coding', 'coding_debug',
    'math', 'math_reasoning',
    'creative', 'general', 'general_chat',
    'research', 'summarization', 'vision', 'multilingual',
  ];

  // ── Derived sets ──────────────────────────────────────────────────────────
  const valid     = results.filter(r => !r.error);
  const errored   = results.filter(r =>  r.error);
  const correct   = valid.filter(r => r.correct);
  const escalated = valid.filter(r => r.escalated);

  const totalActual = valid.reduce((s, r) => s + r.actualCostUsd, 0);
  const totalGpt4o  = valid.reduce((s, r) => s + r.gpt4oCostUsd,  0);
  const savingsPct  = totalGpt4o > 0 ? ((totalGpt4o - totalActual) / totalGpt4o) * 100 : 0;

  const avgLatency = valid.length > 0
    ? valid.reduce((s, r) => s + r.latencyMs, 0) / valid.length : 0;

  const modeCounts: Record<string, number> = {};
  for (const r of valid) modeCounts[r.strategyMode] = (modeCounts[r.strategyMode] ?? 0) + 1;

  const tierCounts: Record<string, number> = {};
  for (const r of valid) tierCounts[r.tier] = (tierCounts[r.tier] ?? 0) + 1;

  console.log('\n\n' + hr('═', W));
  console.log('  BENCHMARK SUMMARY');
  console.log(hr('═', W));

  // ── ① Classification accuracy ─────────────────────────────────────────────
  console.log('\n  ① Classification Accuracy\n');
  console.log('  ┌──────────────────┬───────┬─────────┬──────────┬──────────────┬──────────────┐');
  console.log('  │ Domain           │ Cases │ Correct │ Accuracy │  Easy        │  Hard        │');
  console.log('  ├──────────────────┼───────┼─────────┼──────────┼──────────────┼──────────────┤');

  for (const domain of ALL_DOMAINS) {
    const dr = valid.filter(r => r.testCase.expectedDomain === domain);
    if (dr.length === 0) continue;

    const dcorrect     = dr.filter(r => r.correct).length;
    const easyTotal    = dr.filter(r => r.testCase.difficulty === 'easy').length;
    const easyCorrect  = dr.filter(r => r.testCase.difficulty === 'easy' && r.correct).length;
    const hardTotal    = dr.filter(r => r.testCase.difficulty === 'hard').length;
    const hardCorrect  = dr.filter(r => r.testCase.difficulty === 'hard' && r.correct).length;
    const accStr       = pct(dcorrect, dr.length);
    const easyStr      = `${easyCorrect}/${easyTotal} (${pct(easyCorrect, easyTotal).trim()})`;
    const hardStr      = `${hardCorrect}/${hardTotal} (${pct(hardCorrect, hardTotal).trim()})`;

    console.log(
      `  │ ${pad(domain, 16)} │ ${pad(dr.length, 5, true)} │ ` +
      `${pad(dcorrect, 7, true)} │ ${pad(accStr, 8, true)} │ ` +
      `${pad(easyStr, 12, true)} │ ${pad(hardStr, 12, true)} │`
    );
  }

  console.log('  ├──────────────────┼───────┼─────────┼──────────┼──────────────┼──────────────┤');
  console.log(
    `  │ ${'TOTAL'.padEnd(16)} │ ${pad(valid.length, 5, true)} │ ` +
    `${pad(correct.length, 7, true)} │ ${pad(pct(correct.length, valid.length), 8, true)} │ ` +
    `${''.padEnd(12)} │ ${''.padEnd(12)} │`
  );
  console.log('  └──────────────────┴───────┴─────────┴──────────┴──────────────┴──────────────┘');

  // ── ② Misclassifications ──────────────────────────────────────────────────
  const wrong = valid.filter(r => !r.correct);
  console.log('\n  ② Misclassifications\n');
  if (wrong.length === 0) {
    console.log('  None — 100% classification accuracy\n');
  } else {
    for (const r of wrong) {
      const diff = r.testCase.difficulty.toUpperCase();
      const conf = `conf ${r.confidence.toFixed(2)}`;
      console.log(
        `  [${diff}] ${r.testCase.expectedDomain.padEnd(14)} → ${r.actualDomain.padEnd(14)} ${conf}`
      );
      console.log(`        "${r.testCase.prompt.slice(0, 75)}"`);
    }
  }

  // ── ③ Cost breakdown ──────────────────────────────────────────────────────
  console.log('\n  ③ Cost vs GPT-4o Baseline\n');
  console.log('  ┌──────────────────────────────────────┬───────────────┐');
  console.log('  │ Metric                               │         Value │');
  console.log('  ├──────────────────────────────────────┼───────────────┤');
  console.log(`  │ ${'Total actual cost (all 50 prompts)'.padEnd(36)} │ ${usd(totalActual).padStart(13)} │`);
  console.log(`  │ ${'Hypothetical GPT-4o cost'.padEnd(36)} │ ${usd(totalGpt4o).padStart(13)} │`);
  console.log(`  │ ${'Savings vs GPT-4o'.padEnd(36)} │ ${`${savingsPct.toFixed(1)}%`.padStart(13)} │`);
  console.log(`  │ ${'Cost per request (avg)'.padEnd(36)} │ ${usd(totalActual / Math.max(valid.length, 1)).padStart(13)} │`);
  console.log('  ├──────────────────────────────────────┼───────────────┤');

  for (const tier of ['cheap', 'balanced', 'premium'] as const) {
    const tierResults = valid.filter(r => r.tier === tier);
    if (tierResults.length === 0) continue;
    const tierCost = tierResults.reduce((s, r) => s + r.actualCostUsd, 0);
    const tierAvg  = tierCost / tierResults.length;
    const label    = `Avg cost — ${tier} tier (${tierResults.length} calls)`;
    console.log(`  │ ${pad(label, 36)} │ ${usd(tierAvg).padStart(13)} │`);
  }

  console.log('  └──────────────────────────────────────┴───────────────┘');

  // ── ④ Latency ─────────────────────────────────────────────────────────────
  const latencies  = valid.map(r => r.latencyMs).sort((a, b) => a - b);
  const p50        = latencies[Math.floor(latencies.length * 0.50)] ?? 0;
  const p95        = latencies[Math.floor(latencies.length * 0.95)] ?? 0;
  const maxLat     = latencies[latencies.length - 1] ?? 0;

  console.log('\n  ④ Latency\n');
  console.log('  ┌──────────────────────────────────────┬───────────────┐');
  console.log('  │ Metric                               │         Value │');
  console.log('  ├──────────────────────────────────────┼───────────────┤');
  console.log(`  │ ${'Average'.padEnd(36)} │ ${ms(avgLatency).padStart(13)} │`);
  console.log(`  │ ${'Median (p50)'.padEnd(36)} │ ${ms(p50).padStart(13)} │`);
  console.log(`  │ ${'p95'.padEnd(36)} │ ${ms(p95).padStart(13)} │`);
  console.log(`  │ ${'Max'.padEnd(36)} │ ${ms(maxLat).padStart(13)} │`);
  console.log(`  │ ${'Total wall time'.padEnd(36)} │ ${`${(wallMs / 1000).toFixed(1)} s`.padStart(13)} │`);
  console.log('  ├──────────────────────────────────────┼───────────────┤');

  for (const tier of ['cheap', 'balanced', 'premium'] as const) {
    const tierResults = valid.filter(r => r.tier === tier);
    if (tierResults.length === 0) continue;
    const tierAvg = tierResults.reduce((s, r) => s + r.latencyMs, 0) / tierResults.length;
    const label   = `Avg latency — ${tier} tier`;
    console.log(`  │ ${pad(label, 36)} │ ${ms(tierAvg).padStart(13)} │`);
  }

  console.log('  └──────────────────────────────────────┴───────────────┘');

  // ── ⑤ Routing behaviour ───────────────────────────────────────────────────
  console.log('\n  ⑤ Routing Behaviour\n');
  console.log('  ┌──────────────────────────────────────┬───────────────┐');
  console.log('  │ Metric                               │         Value │');
  console.log('  ├──────────────────────────────────────┼───────────────┤');
  console.log(`  │ ${'Escalation rate'.padEnd(36)} │ ${pct(escalated.length, valid.length).padStart(13)} │`);

  for (const mode of ['exploitation', 'exploration', 'fallback']) {
    const count = modeCounts[mode] ?? 0;
    console.log(`  │ ${`Strategy: ${mode}`.padEnd(36)} │ ${`${count} (${pct(count, valid.length)})`.padStart(13)} │`);
  }

  console.log('  ├──────────────────────────────────────┼───────────────┤');

  for (const tier of ['cheap', 'balanced', 'premium']) {
    const count = tierCounts[tier] ?? 0;
    console.log(`  │ ${`Tier: ${tier}`.padEnd(36)} │ ${`${count} (${pct(count, valid.length)})`.padStart(13)} │`);
  }

  if (errored.length > 0) {
    console.log('  ├──────────────────────────────────────┼───────────────┤');
    console.log(`  │ ${'Errored requests'.padEnd(36)} │ ${String(errored.length).padStart(13)} │`);
  }

  console.log('  └──────────────────────────────────────┴───────────────┘');

  // ── ⑥ Model distribution ─────────────────────────────────────────────────
  // Short display names so the table fits the terminal width
  const MODEL_SHORT: Record<string, string> = {
    'openai/gpt-4o-mini':                            'GPT-4o mini',
    'openai/gpt-4o':                                 'GPT-4o',
    'anthropic/claude-haiku-4.5':                    'Claude Haiku',
    'anthropic/claude-sonnet-4.6':                   'Claude Sonnet',
    'anthropic/claude-opus-4.6':                     'Claude Opus',
    'meta-llama/llama-3.1-8b-instruct':              'Llama 3.1 8B',
    'meta-llama/llama-3.3-70b-instruct':             'Llama 3.3 70B',
    'qwen/qwen-2.5-72b-instruct':                    'Qwen 2.5 72B',
    'meta-llama/llama-4-scout':                      'Llama 4 Scout',
    'deepseek/deepseek-v3.2':                        'DeepSeek V3.2',
    'qwen/qwen3-235b-a22b':                          'Qwen3 235B',
    'meta-llama/llama-4-maverick':                   'Llama 4 Maverick',
  };

  const modelCounts: Record<string, { calls: number; tier: string; totalCost: number; totalLatency: number }> = {};
  for (const r of valid) {
    if (!r.model) continue;
    const entry = modelCounts[r.model] ?? { calls: 0, tier: r.tier, totalCost: 0, totalLatency: 0 };
    entry.calls++;
    entry.totalCost    += r.actualCostUsd;
    entry.totalLatency += r.latencyMs;
    modelCounts[r.model] = entry;
  }

  const sortedModels = Object.entries(modelCounts).sort((a, b) => b[1].calls - a[1].calls);

  if (sortedModels.length > 0) {
    console.log('\n  ⑥ Model Distribution\n');
    console.log('  ┌────────────────────┬──────────┬───────┬──────────────┬──────────────┐');
    console.log('  │ Model              │ Tier     │ Calls │  Avg Latency │    Avg Cost  │');
    console.log('  ├────────────────────┼──────────┼───────┼──────────────┼──────────────┤');

    for (const [modelId, data] of sortedModels) {
      const shortName  = MODEL_SHORT[modelId] ?? modelId.split('/').pop() ?? modelId;
      const avgLatency = data.totalLatency / data.calls;
      const avgCost    = data.totalCost    / data.calls;
      const pctCalls   = `${data.calls} (${((data.calls / valid.length) * 100).toFixed(0)}%)`;

      console.log(
        `  │ ${pad(shortName.slice(0, 18), 18)} │ ${pad(data.tier, 8)} │ ` +
        `${pad(pctCalls, 5, true)} │ ${ms(avgLatency).padStart(12)} │ ${usd(avgCost).padStart(12)} │`
      );
    }

    console.log('  └────────────────────┴──────────┴───────┴──────────────┴──────────────┘');
  }

  // ── Interpretation guide ─────────────────────────────────────────────────
  printInterpretation({
    correctCount:   correct.length,
    totalCount:     valid.length,
    savingsPct,
    escalatedCount: escalated.length,
    avgLatencyMs:   avgLatency,
    p95LatencyMs:   p95,
    easyCorrect:    valid.filter(r => r.testCase.difficulty === 'easy' && r.correct).length,
    easyTotal:      valid.filter(r => r.testCase.difficulty === 'easy').length,
    hardCorrect:    valid.filter(r => r.testCase.difficulty === 'hard' && r.correct).length,
    hardTotal:      valid.filter(r => r.testCase.difficulty === 'hard').length,
  });
}

// ---------------------------------------------------------------------------
// Interpretation guide
// ---------------------------------------------------------------------------

interface InterpretationParams {
  correctCount:   number;
  totalCount:     number;
  savingsPct:     number;
  escalatedCount: number;
  avgLatencyMs:   number;
  p95LatencyMs:   number;
  easyCorrect:    number;
  easyTotal:      number;
  hardCorrect:    number;
  hardTotal:      number;
}

function printInterpretation(p: InterpretationParams): void {
  const accuracy  = p.totalCount   > 0 ? (p.correctCount   / p.totalCount)   * 100 : 0;
  const escalPct  = p.totalCount   > 0 ? (p.escalatedCount / p.totalCount)   * 100 : 0;
  const easyAcc   = p.easyTotal    > 0 ? (p.easyCorrect    / p.easyTotal)    * 100 : 0;
  const hardAcc   = p.hardTotal    > 0 ? (p.hardCorrect    / p.hardTotal)    * 100 : 0;

  console.log('\n  ══════════════════════════════════════════════════════════════════════════════════');
  console.log('  HOW TO INTERPRET THESE RESULTS');
  console.log('  ══════════════════════════════════════════════════════════════════════════════════');

  // ── Accuracy ──────────────────────────────────────────────────────────────
  const accStatus =
    accuracy >= 92 ? '✓ EXCELLENT' :
    accuracy >= 82 ? '~ GOOD' :
    accuracy >= 68 ? '△ FAIR — embedding anchors may need tuning' :
                     '✗ POOR — likely no OPENAI_API_KEY; rule-based only';

  console.log(`
  ① Classification accuracy: ${accuracy.toFixed(1)}%  →  ${accStatus}
     Easy prompts (rule-based): ${easyAcc.toFixed(1)}%  Hard prompts (semantic): ${hardAcc.toFixed(1)}%

     TARGET NUMBERS:
       ≥ 95% easy   Rule-based keyword signals working correctly.
       ≥ 82% hard   Embedding classifier firing; anchor prompts have broad coverage.
       < 68% overall  Almost certainly no OPENAI_API_KEY. Set it and restart the server.

     WHAT TO DO IF HARD ACCURACY IS LOW:
       Add more diverse anchor examples to hybridClassifier.ts for the failing domain.
       The embedding classifier picks the nearest anchor — more anchors = better coverage.
       Aim for 3–5 anchor phrases per domain that cover different phrasings.`);

  // ── Cost ──────────────────────────────────────────────────────────────────
  const costStatus =
    p.savingsPct >= 65 ? '✓ EXCELLENT — router avoids GPT-4o for the vast majority of requests' :
    p.savingsPct >= 45 ? '~ GOOD' :
    p.savingsPct >= 25 ? '△ FAIR — more premium-tier routing than expected' :
                         '✗ LOW — most requests may be hitting premium tier; check routing table';

  console.log(`
  ② Cost savings vs GPT-4o: ${p.savingsPct.toFixed(1)}%  →  ${costStatus}

     TARGET NUMBERS:
       ≥ 65%  Router directing easy tasks to cheap/balanced tiers. Typical range.
       45–65% Mixed. Some domains legitimately hit premium (research, coding_debug).
       < 45%  Review ROUTING table in providers/index.ts — many tasks may map to premium providers.

     NOTE: Vision prompts almost always hit premium (GPT-4o / Claude Opus are the capable models).
     Research and coding_debug are also naturally higher cost. General_chat and summarization
     should consistently be cheap-tier.`);

  // ── Latency ───────────────────────────────────────────────────────────────
  const latStatus =
    p.avgLatencyMs <= 1500 ? '✓ FAST — cheap-tier models responding well' :
    p.avgLatencyMs <= 3000 ? '~ ACCEPTABLE' :
    p.avgLatencyMs <= 5000 ? '△ SLOW — many requests hitting premium or escalation' :
                             '✗ VERY SLOW — check provider rate limits or network issues';

  console.log(`
  ③ Average latency: ${Math.round(p.avgLatencyMs)}ms  p95: ${Math.round(p.p95LatencyMs)}ms  →  ${latStatus}

     TARGET NUMBERS (end-to-end, including network to provider):
       avg < 800ms   Cheap tier (Llama 3.2 3B, Mistral 7B, Claude Haiku)
       avg 800–2000ms Balanced tier (Qwen 72B, Claude Sonnet, GPT-4o-mini)
       avg 2–5s      Premium tier or escalated requests (Claude Opus, GPT-4o)
       p95 < 6s      Any outliers above this indicate provider timeouts or cold starts.

     High p95 with normal average = occasional escalation spikes. Tune CONFIDENCE_THRESHOLD.`);

  // ── Escalation ────────────────────────────────────────────────────────────
  const escalStatus =
    escalPct <= 5  ? '△ LOW — classifier may be overconfident; consider lowering CONFIDENCE_THRESHOLD' :
    escalPct <= 20 ? '✓ HEALTHY' :
    escalPct <= 35 ? '~ ELEVATED — many ambiguous prompts or threshold is too low' :
                     '✗ HIGH — CONFIDENCE_THRESHOLD may be set too low; router is escalating excessively';

  console.log(`
  ④ Escalation rate: ${escalPct.toFixed(1)}%  →  ${escalStatus}

     TARGET NUMBERS:
       5–20%   Healthy. Fires on genuinely ambiguous prompts (cross-domain language).
       < 5%    Rarely fires. Lower CONFIDENCE_THRESHOLD (env var) from 0.6 toward 0.5.
       20–35%  Elevated. Hard benchmark prompts may be triggering it — check misclassified set.
       > 35%   Threshold too low. Raise CONFIDENCE_THRESHOLD toward 0.7.

     WHAT ESCALATION COSTS: each escalated request calls TWO models and doubles latency + cost.
     Use the misclassification list in ② to see whether escalated prompts were genuinely ambiguous.`);

  console.log('\n  ══════════════════════════════════════════════════════════════════════════════════\n');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

runBenchmark().catch((err) => {
  console.error('\nFATAL:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
