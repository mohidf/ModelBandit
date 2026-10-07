/**
 * Tests for calibrationPlan.ts — the pure planning half of the calibrate
 * script: which (task type, model) arms to sample, which prompts to send
 * them, what that could cost, and how the CLI flags are read.
 */

import {
  armsFor,
  buildPlan,
  estimatePlanCostUsd,
  isAccountError,
  parseCalibrationArgs,
  MAX_CONSECUTIVE_FAILURES,
} from '../scripts/calibrationPlan';
import { config } from '../config';
import type { RoutingConfig } from '../config/routing';
import type { TaskDomain } from '../providers/types';
import { ROUTING } from '../config/routing';
import { TEST_CASES } from '../scripts/benchmarkPrompts';
import { getModelById } from '../config/models';

const OPEN = {
  cheap:    'meta-llama/llama-3.1-8b-instruct',
  balanced: 'meta-llama/llama-3.3-70b-instruct',
  premium:  'deepseek/deepseek-v3.2',
} as const;

const ALL_DOMAINS = Object.keys(ROUTING) as TaskDomain[];

describe('armsFor', () => {
  it('returns one arm per routing-table model for each task type', () => {
    const arms = armsFor(ROUTING);
    for (const domain of ALL_DOMAINS) {
      const models = new Set(Object.values(ROUTING[domain].models));
      const forDomain = arms.filter(a => a.taskType === domain).map(a => a.modelId);
      expect(new Set(forDomain)).toEqual(models);
    }
  });

  it('deduplicates a model that fills two tiers of the same task type', () => {
    const routing = {
      ...ROUTING,
      coding: { models: { cheap: 'x/a', balanced: 'x/a', premium: 'x/b' }, reason: 'r' },
    } as RoutingConfig;
    const arms = armsFor(routing, ['coding']);
    expect(arms.map(a => a.modelId)).toEqual(['x/a', 'x/b']);
  });

  it('does not include escalateTo models (they are the expensive last resort)', () => {
    const arms = armsFor(ROUTING, ['coding']);
    expect(arms.map(a => a.modelId)).not.toContain(ROUTING.coding.escalateTo);
  });

  it('limits arms to the requested task types', () => {
    const arms = armsFor(ROUTING, ['math', 'vision']);
    expect(new Set(arms.map(a => a.taskType))).toEqual(new Set(['math', 'vision']));
  });

  it('orders arms cheap → balanced → premium within a task type', () => {
    const arms = armsFor(ROUTING, ['coding']);
    expect(arms.map(a => a.modelId)).toEqual([OPEN.cheap, OPEN.balanced, OPEN.premium]);
  });
});

describe('buildPlan', () => {
  const prompts = [
    { prompt: 'c1', expectedDomain: 'coding' as const },
    { prompt: 'c2', expectedDomain: 'coding' as const },
    { prompt: 'm1', expectedDomain: 'math' as const },
  ];

  it('creates perArm jobs for every arm', () => {
    const arms = armsFor(ROUTING, ['coding', 'math']);
    const jobs = buildPlan(arms, prompts, 3);
    expect(jobs).toHaveLength(arms.length * 3);
    for (const arm of arms) {
      const mine = jobs.filter(j => j.taskType === arm.taskType && j.modelId === arm.modelId);
      expect(mine).toHaveLength(3);
    }
  });

  it('only sends an arm prompts labeled with its own task type', () => {
    const jobs = buildPlan(armsFor(ROUTING, ['coding', 'math']), prompts, 2);
    for (const job of jobs) {
      const label = prompts.find(p => p.prompt === job.prompt)!.expectedDomain;
      expect(label).toBe(job.taskType);
    }
  });

  it('cycles through the prompt pool when perArm exceeds it', () => {
    const jobs = buildPlan(armsFor(ROUTING, ['coding']), prompts, 3)
      .filter(j => j.modelId === OPEN.cheap);
    expect(jobs.map(j => j.prompt)).toEqual(['c1', 'c2', 'c1']);
  });

  it('interleaves arms round by round so a stopped run still covers every arm', () => {
    const arms = armsFor(ROUTING, ['coding', 'math']);
    const jobs = buildPlan(arms, prompts, 2);
    const firstRound = jobs.slice(0, arms.length);
    expect(new Set(firstRound.map(j => `${j.taskType}|${j.modelId}`)).size).toBe(arms.length);
  });

  it('throws when a task type has no prompts', () => {
    expect(() => buildPlan(armsFor(ROUTING, ['vision']), prompts, 1))
      .toThrow(/no prompts.*vision/i);
  });

  it('throws on a non-positive perArm', () => {
    expect(() => buildPlan(armsFor(ROUTING, ['coding']), prompts, 0)).toThrow(/perArm/);
  });

  it('has prompts for every task type in the real benchmark set', () => {
    expect(() => buildPlan(armsFor(ROUTING), TEST_CASES, 1)).not.toThrow();
  });
});

describe('estimatePlanCostUsd', () => {
  it('prices input at ~4 characters a token and output at the full maxTokens', () => {
    const jobs = [{ taskType: 'coding' as const, modelId: OPEN.cheap, prompt: 'x'.repeat(400) }];
    const price = getModelById(OPEN.cheap)!.costPer1kTokens;
    const expected = (100 * price.input + 256 * price.output) / 1000;
    expect(estimatePlanCostUsd(jobs, 256)).toBeCloseTo(expected, 10);
  });

  it('sums across jobs', () => {
    const job = { taskType: 'coding' as const, modelId: OPEN.cheap, prompt: 'hello' };
    expect(estimatePlanCostUsd([job, job], 100)).toBeCloseTo(2 * estimatePlanCostUsd([job], 100), 12);
  });

  it('throws for a model missing from the registry', () => {
    const job = { taskType: 'coding' as const, modelId: 'nope/missing', prompt: 'hi' };
    expect(() => estimatePlanCostUsd([job], 100)).toThrow(/nope\/missing/);
  });

  it('keeps the full default plan under a dollar', () => {
    const jobs = buildPlan(armsFor(ROUTING), TEST_CASES, 5);
    expect(estimatePlanCostUsd(jobs, config.defaultMaxTokens)).toBeLessThan(1);
  });
});

describe('parseCalibrationArgs', () => {
  it('has safe defaults', () => {
    expect(parseCalibrationArgs([])).toEqual({
      perArm: 5, maxTokens: config.defaultMaxTokens, maxUsd: 1, dryRun: false, taskTypes: undefined,
    });
  });

  it('defaults maxTokens to what organic /route traffic uses, so costs and latencies are comparable', () => {
    expect(parseCalibrationArgs([]).maxTokens).toBe(config.defaultMaxTokens);
  });

  it('reads every flag', () => {
    const args = parseCalibrationArgs([
      '--per-arm', '3', '--max-tokens', '128', '--max-usd', '0.25', '--dry-run', '--tasks', 'coding,math',
    ]);
    expect(args).toEqual({
      perArm: 3, maxTokens: 128, maxUsd: 0.25, dryRun: true, taskTypes: ['coding', 'math'],
    });
  });

  it('rejects an unknown task type', () => {
    expect(() => parseCalibrationArgs(['--tasks', 'coding,cooking'])).toThrow(/cooking/);
  });

  it('rejects non-numeric or non-positive numbers', () => {
    expect(() => parseCalibrationArgs(['--per-arm', 'many'])).toThrow(/--per-arm/);
    expect(() => parseCalibrationArgs(['--max-usd', '0'])).toThrow(/--max-usd/);
    expect(() => parseCalibrationArgs(['--max-tokens', '-5'])).toThrow(/--max-tokens/);
  });

  it('rejects an unknown flag', () => {
    expect(() => parseCalibrationArgs(['--yolo'])).toThrow(/--yolo/);
  });
});

describe('isAccountError', () => {
  const withStatus = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

  it.each([401, 402, 403, 429])('treats HTTP %i as an account problem, not a model failure', status => {
    expect(isAccountError(withStatus(status))).toBe(true);
  });

  it.each([500, 502, 503, 408])('treats HTTP %i as a model or provider failure', status => {
    expect(isAccountError(withStatus(status))).toBe(false);
  });

  it('treats errors without a status (timeouts, empty answers) as model failures', () => {
    expect(isAccountError(new Error('Request timed out'))).toBe(false);
    expect(isAccountError('boom')).toBe(false);
    expect(isAccountError(undefined)).toBe(false);
  });
});

describe('MAX_CONSECUTIVE_FAILURES', () => {
  it('stops a run early enough that a broken setup writes only a few failure rows', () => {
    expect(MAX_CONSECUTIVE_FAILURES).toBeGreaterThanOrEqual(2);
    expect(MAX_CONSECUTIVE_FAILURES).toBeLessThanOrEqual(5);
  });
});
