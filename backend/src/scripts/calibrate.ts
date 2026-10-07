#!/usr/bin/env ts-node
/**
 * calibrate.ts
 *
 * Seeds the performance table with real numbers for every routing-table
 * model on every task type, so the bandit (and the browser demo, through
 * export:snapshot) ranks models from measured cost and latency instead of
 * the handful of rows that 10% exploration produces on its own.
 *
 * Each job calls one model through OpenRouter with a labeled prompt from
 * benchmarkPrompts.ts and records the result exactly as the router does:
 * a success with the model's confidence, a failure with confidence 0.
 *
 * Usage:
 *   cd backend
 *   npm run calibrate -- --dry-run                 # print the plan and its cost, call nothing
 *   npm run calibrate                              # 5 calls per model per task type, $1 cap
 *   npm run calibrate -- --per-arm 3 --tasks coding,math --max-usd 0.25
 *   npm run export:snapshot                        # then refresh the demo's snapshot
 *
 * Needs OPENROUTER_API_KEY and DATABASE_URL (backend/.env, or the production
 * values through `railway run -- npm run calibrate`). It writes to whatever
 * database DATABASE_URL points at.
 */

import 'dotenv/config';
import { ROUTING } from '../config/routing';
import type { DispatchResult } from '../providers';
import { TEST_CASES } from './benchmarkPrompts';
import {
  armsFor,
  buildPlan,
  estimatePlanCostUsd,
  isAccountError,
  parseCalibrationArgs,
  MAX_CONSECUTIVE_FAILURES,
  type CalibrationArgs,
  type CalibrationJob,
} from './calibrationPlan';

const REQUIRED_ENV = ['OPENROUTER_API_KEY', 'DATABASE_URL'] as const;

function printPlan(jobs: readonly CalibrationJob[], args: CalibrationArgs, estimateUsd: number): void {
  const byTask = new Map<string, Set<string>>();
  for (const job of jobs) {
    byTask.set(job.taskType, (byTask.get(job.taskType) ?? new Set()).add(job.modelId));
  }

  console.log(`\nCalibration plan: ${jobs.length} calls, ${args.perArm} per model per task type, ` +
    `max ${args.maxTokens} output tokens each\n`);
  for (const [taskType, models] of byTask) {
    console.log(`  ${taskType.padEnd(15)} ${[...models].join(', ')}`);
  }
  console.log(`\n  Worst-case cost: $${estimateUsd.toFixed(4)}   Spend cap: $${args.maxUsd.toFixed(2)}`);
  if (estimateUsd > args.maxUsd) {
    console.log('  The worst case is over the cap, so the run may stop before every call is made.');
  }
  console.log();
}

async function runJobs(jobs: readonly CalibrationJob[], args: CalibrationArgs): Promise<void> {
  // Imported here so --dry-run works without any keys or database.
  const { providerManager } = await import('../providers');
  const { performanceStore } = await import('../services/performanceStore');

  let spentUsd = 0;
  let done = 0;
  let failed = 0;
  let failedInARow = 0;

  try {
    for (const [i, job] of jobs.entries()) {
      if (spentUsd >= args.maxUsd) {
        console.log(`\nStopped at the $${args.maxUsd} spend cap.`);
        break;
      }

      const resolved = providerManager.resolveByModelId(job.modelId, 'calibration run');
      const record   = (latencyMs: number, confidence: number, escalated: boolean, costUsd: number) =>
        performanceStore.recordResult({
          modelId:  job.modelId,
          provider: resolved.provider.name,
          tier:     resolved.tier,
          taskType: job.taskType,
          latencyMs, confidence, escalated, costUsd,
        });
      const label   = `[${String(i + 1).padStart(3)}/${jobs.length}] ${job.taskType.padEnd(15)} ${job.modelId}`;
      const started = Date.now();

      let outcome: DispatchResult;
      try {
        outcome = await providerManager.dispatch(resolved, job.prompt, { maxTokens: args.maxTokens });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // A bad key, an empty account or a rate limit is not the model's
        // fault: recording it would mark every arm unreliable. Stop instead.
        if (isAccountError(err)) throw new Error(`Account problem, nothing recorded for this call: ${message}`);

        // Anything else is recorded the way the router records a failed
        // call, so the scorer learns the model is unreliable.
        await record(Date.now() - started, 0, true, 0);
        done++;
        failed++;
        failedInARow++;
        console.log(`${label}  FAILED: ${message.slice(0, 120)}`);
        if (failedInARow >= MAX_CONSECUTIVE_FAILURES) {
          throw new Error(`${failedInARow} calls failed in a row; stopping before more failures are recorded`);
        }
        continue;
      }

      const { result, cost } = outcome;
      spentUsd += cost.totalCostUsd;
      await record(result.latencyMs, result.modelConfidence, false, cost.totalCostUsd);
      done++;
      failedInARow = 0;
      console.log(`${label}  ${result.latencyMs} ms  $${cost.totalCostUsd.toFixed(6)}`);
    }
  } finally {
    console.log(`\n${done} of ${jobs.length} calls recorded (${failed} as failures). Spent about $${spentUsd.toFixed(4)}.`);
    if (done > 0) console.log('Next: npm run export:snapshot to refresh demo/src/snapshot.json.');
  }
}

async function main(): Promise<void> {
  const args  = parseCalibrationArgs(process.argv.slice(2));
  const jobs  = buildPlan(armsFor(ROUTING, args.taskTypes), TEST_CASES, args.perArm);
  const worst = estimatePlanCostUsd(jobs, args.maxTokens);

  printPlan(jobs, args, worst);
  if (args.dryRun) return;

  const missing = REQUIRED_ENV.filter(name => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing ${missing.join(', ')}. Set them in backend/.env, ` +
      'or run with production values: railway run -- npm run calibrate');
  }

  await runJobs(jobs, args);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    process.stderr.write(`Calibration failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
