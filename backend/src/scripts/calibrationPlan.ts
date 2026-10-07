/**
 * calibrationPlan.ts — the pure planning half of calibrate.ts.
 *
 * The router only tries a model it has no history for 10% of the time, so
 * the performance table (and the browser demo's snapshot of it) fills in
 * slowly: most task types end up with one model and a handful of rows. A
 * calibration run samples every routing-table model on every task type with
 * labeled prompts, so the bandit starts from real numbers for all of them.
 *
 * Nothing here touches the network or the database, so it is unit tested
 * and calibrate.ts can print a plan and its cost before spending anything.
 */

import type { RoutingConfig } from '../config/routing';
import { config } from '../config';
import { getModelById } from '../config/models';
import { ALL_DOMAINS, type ModelTier, type TaskDomain } from '../providers/types';

/** One (task type, model) pair the bandit keeps a running average for. */
export interface CalibrationArm {
  taskType: TaskDomain;
  modelId:  string;
}

/** One provider call to make: an arm and the prompt to send it. */
export interface CalibrationJob extends CalibrationArm {
  prompt: string;
}

/** A labeled prompt (benchmarkPrompts.ts has 50 of them). */
export interface LabeledPrompt {
  prompt:         string;
  expectedDomain: TaskDomain;
}

export interface CalibrationArgs {
  perArm:    number;
  maxTokens: number;
  maxUsd:    number;
  dryRun:    boolean;
  taskTypes: TaskDomain[] | undefined;
}

/**
 * HTTP statuses that mean the account is the problem (bad key, no credit,
 * rate limited), not the model. Recording those as model failures would
 * write confidence-0 rows for every arm, so the run stops instead.
 */
const ACCOUNT_ERROR_STATUSES: readonly number[] = [401, 402, 403, 429];

/** Model failures in a row before a run gives up: something is wrong beyond one model. */
export const MAX_CONSECUTIVE_FAILURES = 3;

const TIER_ORDER: readonly ModelTier[] = ['cheap', 'balanced', 'premium'];

/** Rough token count for a prompt, the same ~4 characters a token the classifier uses. */
const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

/**
 * Every distinct cheap/balanced/premium model for each task type, in tier
 * order. escalateTo models are left out: they are the expensive last resort
 * and the router only reaches them through escalation.
 */
export function armsFor(routing: RoutingConfig, taskTypes?: readonly TaskDomain[]): CalibrationArm[] {
  const domains = taskTypes ?? (Object.keys(routing) as TaskDomain[]);
  return domains.flatMap(taskType => {
    const models = TIER_ORDER.map(tier => routing[taskType].models[tier]);
    return [...new Set(models)].map(modelId => ({ taskType, modelId }));
  });
}

/**
 * perArm jobs for every arm, each with a prompt labeled for the arm's task
 * type (cycling through the pool when it is smaller than perArm). Jobs are
 * interleaved round by round, so a run stopped by the spend cap still has
 * samples for every arm rather than all of one task type and none of another.
 */
export function buildPlan(
  arms:    readonly CalibrationArm[],
  prompts: readonly LabeledPrompt[],
  perArm:  number,
): CalibrationJob[] {
  if (!Number.isInteger(perArm) || perArm < 1) {
    throw new Error(`perArm must be a positive integer, got ${perArm}`);
  }

  const pool = new Map<TaskDomain, string[]>();
  for (const arm of arms) {
    const own = prompts.filter(p => p.expectedDomain === arm.taskType).map(p => p.prompt);
    if (own.length === 0) throw new Error(`No prompts labeled for task type "${arm.taskType}"`);
    pool.set(arm.taskType, own);
  }

  return Array.from({ length: perArm }, (_, round) =>
    arms.map(arm => {
      const own = pool.get(arm.taskType)!;
      return { ...arm, prompt: own[round % own.length] };
    }),
  ).flat();
}

/**
 * Upper bound on what a plan costs: registry prices, input at ~4 characters
 * a token, and every response assumed to use the full maxTokens.
 */
export function estimatePlanCostUsd(jobs: readonly CalibrationJob[], maxTokens: number): number {
  return jobs.reduce((total, job) => {
    const model = getModelById(job.modelId);
    if (!model) throw new Error(`Model "${job.modelId}" is not in the model registry`);
    const { input, output } = model.costPer1kTokens;
    return total + (estimateTokens(job.prompt) * input + maxTokens * output) / 1000;
  }, 0);
}

function positiveNumber(flag: string, raw: string | undefined, integer: boolean): number {
  const value = Number(raw);
  if (raw === undefined || !Number.isFinite(value) || value <= 0 || (integer && !Number.isInteger(value))) {
    throw new Error(`${flag} needs a positive ${integer ? 'integer' : 'number'}, got "${raw ?? ''}"`);
  }
  return value;
}

function taskList(raw: string | undefined): TaskDomain[] {
  const names = (raw ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const unknown = names.filter(n => !ALL_DOMAINS.includes(n as TaskDomain));
  if (names.length === 0 || unknown.length > 0) {
    throw new Error(`--tasks has unknown task types: ${unknown.join(', ') || '(none given)'}. ` +
      `Known: ${ALL_DOMAINS.join(', ')}`);
  }
  return names as TaskDomain[];
}

/** Reads `--per-arm N --max-tokens N --max-usd X --tasks a,b --dry-run`. */
export function parseCalibrationArgs(argv: readonly string[]): CalibrationArgs {
  const args: CalibrationArgs = { perArm: 5, maxTokens: config.defaultMaxTokens, maxUsd: 1, dryRun: false, taskTypes: undefined };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    switch (flag) {
      case '--per-arm':    args.perArm    = positiveNumber(flag, argv[++i], true);  break;
      case '--max-tokens': args.maxTokens = positiveNumber(flag, argv[++i], true);  break;
      case '--max-usd':    args.maxUsd    = positiveNumber(flag, argv[++i], false); break;
      case '--tasks':      args.taskTypes = taskList(argv[++i]);                    break;
      case '--dry-run':    args.dryRun    = true;                                   break;
      default: throw new Error(`Unknown flag ${flag}`);
    }
  }
  return args;
}

/** True for errors carrying an HTTP status in ACCOUNT_ERROR_STATUSES. */
export function isAccountError(err: unknown): boolean {
  const status = (err as { status?: unknown } | null | undefined)?.status;
  return typeof status === 'number' && ACCOUNT_ERROR_STATUSES.includes(status);
}
