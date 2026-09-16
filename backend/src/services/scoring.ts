/**
 * scoring.ts — the pure part of the strategy engine.
 *
 * Nothing here touches the database, the environment, or a provider, so the
 * browser demo in demo/ can import it and score models exactly the way the
 * server does. StrategyEngine layers env overrides and exploration on top.
 */

import type { TaskDomain, TaskComplexity, ModelTier } from '../providers/types';

// ---------------------------------------------------------------------------
// Normalisation bounds
//
// Each metric is divided by its maximum before scoring so that all inputs
// are in [0, 1] and weights have consistent meaning regardless of unit scales.
// ---------------------------------------------------------------------------

/**
 * Maximum expected cost per API call in USD used for normalisation.
 * Real-world ranges: cheap $0.0001–$0.001, balanced $0.005–$0.015,
 * premium $0.015–$0.05. Calls above this clamp to 1 (worst possible penalty).
 */
export const MAX_COST_USD = 0.20;

/**
 * Maximum expected latency in ms used for normalisation.
 * In practice models range 500ms–20000ms. Calls above this clamp to 1.
 */
export const MAX_LATENCY_MS = 30_000;

/** Tiers valid for exploration at each complexity level. */
export const EXPLORATION_TIERS: Record<TaskComplexity, readonly ModelTier[]> = {
  low:    ['cheap', 'balanced'],
  medium: ['cheap', 'balanced', 'premium'],
  high:   ['balanced', 'premium'],
};

export interface TaskWeights {
  confidenceWeight: number;
  costWeight: number;
  latencyWeight: number;
  escalationWeight: number;
}

export type OptimizationMode = 'cost' | 'quality' | 'balanced';

export interface WeightOverrideConfig {
  optimizationMode?: OptimizationMode;
  customWeights?: Partial<TaskWeights>;
}

/** The subset of PerformanceStats that scoring needs. */
export interface ScorableStats {
  averageConfidence: number;
  averageLatencyMs:  number;
  averageCostUsd:    number;
  escalationRate:    number;
}

// Default weights per task domain.
//
// All metrics are normalised to [0, 1] before scoring, so these weights are
// directly comparable to each other — a weight of 2.0 means "twice as
// important" relative to a weight of 1.0.
export const DEFAULT_TASK_WEIGHTS: Readonly<Record<TaskDomain, TaskWeights>> = {
  coding: {
    confidenceWeight: 2.0,  // correctness matters most
    costWeight:       3.0,  // cost differentiates when all providers return equal confidence
    latencyWeight:    0.5,
    escalationWeight: 0.8,  // reduced: escalation reflects classifier ambiguity, not model quality
  },
  coding_debug: {
    confidenceWeight: 3.0,  // highest correctness bar — wrong debug advice wastes dev time
    costWeight:       2.0,
    latencyWeight:    0.5,
    escalationWeight: 1.0,
  },
  math: {
    confidenceWeight: 2.5,  // accuracy is critical
    costWeight:       3.0,
    latencyWeight:    0.5,
    escalationWeight: 0.8,
  },
  math_reasoning: {
    confidenceWeight: 3.0,  // chain-of-thought correctness is paramount
    costWeight:       2.5,
    latencyWeight:    0.5,
    escalationWeight: 1.0,
  },
  creative: {
    confidenceWeight: 1.0,
    costWeight:       4.0,  // creative tasks have lowest correctness bar, most cost-sensitive
    latencyWeight:    0.3,
    // Low escalation penalty: escalation here reflects low classifier confidence,
    // not poor model output quality — don't double-punish cheap models for it.
    escalationWeight: 0.2,
  },
  research: {
    confidenceWeight: 2.0,  // factual accuracy over cost
    costWeight:       1.5,
    latencyWeight:    0.5,
    escalationWeight: 1.5,
  },
  summarization: {
    confidenceWeight: 1.0,  // any capable model can summarize — optimize for cost
    costWeight:       4.5,
    latencyWeight:    0.5,
    escalationWeight: 0.2,  // same rationale as creative — don't penalize cheap models
  },
  vision: {
    confidenceWeight: 2.5,  // quality matters — only certain models support vision
    costWeight:       1.5,
    latencyWeight:    1.0,
    escalationWeight: 2.0,
  },
  general: {
    confidenceWeight: 1.0,
    costWeight:       4.0,  // general queries should use cheapest adequate model
    latencyWeight:    1.0,
    // Escalation on general queries reflects ambiguous phrasing, not model failure.
    escalationWeight: 0.2,
  },
  general_chat: {
    confidenceWeight: 0.8,  // speed and cost dominate for chitchat
    costWeight:       4.5,
    latencyWeight:    1.5,
    escalationWeight: 0.2,  // chitchat escalation is nearly always classifier noise
  },
  multilingual: {
    confidenceWeight: 2.0,  // translation quality matters
    costWeight:       2.5,
    latencyWeight:    0.8,
    escalationWeight: 0.5,
  },
};

// Presets applied when a per-request optimizationMode is set.
// Override specific weights — unspecified weights stay at the domain default.
export const OPTIMIZATION_PRESETS: Record<Exclude<OptimizationMode, 'balanced'>, Partial<TaskWeights>> = {
  cost: {
    costWeight:       5.0,   // cost dominates
    confidenceWeight: 0.5,
    escalationWeight: 0.5,
  },
  quality: {
    confidenceWeight: 4.0,   // confidence and low escalation dominate
    escalationWeight: 3.0,
    costWeight:       0.3,
  },
};

/**
 * Clamp a weight value to a safe range [0, 100].
 * Rejects non-finite values (NaN, Infinity) from request-supplied customWeights.
 * Falls back to the provided default so a bad user-supplied weight never
 * inverts the scoring function.
 */
export function clampWeight(value: number, defaultValue: number): number {
  if (!isFinite(value) || value < 0) return defaultValue;
  return Math.min(value, 100);
}

/** Apply an optimisation preset and any custom weights on top of a base set. */
export function applyOverrides(base: TaskWeights, override?: WeightOverrideConfig): TaskWeights {
  let weights = base;

  const mode = override?.optimizationMode;
  if (mode && mode !== 'balanced') {
    weights = { ...weights, ...OPTIMIZATION_PRESETS[mode] };
  }

  const cw = override?.customWeights;
  if (cw) {
    weights = {
      confidenceWeight: cw.confidenceWeight !== undefined ? clampWeight(cw.confidenceWeight, weights.confidenceWeight) : weights.confidenceWeight,
      costWeight:       cw.costWeight       !== undefined ? clampWeight(cw.costWeight,       weights.costWeight)       : weights.costWeight,
      latencyWeight:    cw.latencyWeight    !== undefined ? clampWeight(cw.latencyWeight,    weights.latencyWeight)    : weights.latencyWeight,
      escalationWeight: cw.escalationWeight !== undefined ? clampWeight(cw.escalationWeight, weights.escalationWeight) : weights.escalationWeight,
    };
  }

  return weights;
}

/**
 * Score one model's running averages under a set of weights.
 * Each metric is normalised to [0, 1] first so the weights are dimensionless.
 */
export function scoreStats(stats: ScorableStats, weights: TaskWeights): number {
  const normCost    = Math.min(stats.averageCostUsd   / MAX_COST_USD,   1);
  const normLatency = Math.min(stats.averageLatencyMs / MAX_LATENCY_MS, 1);
  // averageConfidence and escalationRate are already in [0, 1].
  return (
      weights.confidenceWeight * stats.averageConfidence
    - weights.costWeight       * normCost
    - weights.latencyWeight    * normLatency
    - weights.escalationWeight * stats.escalationRate
  );
}

/**
 * Sort comparator for scored candidates: best score first, ties broken by
 * lower cost then lower latency so DB insertion order never decides.
 */
export function compareScored<T extends ScorableStats & { score: number }>(a: T, b: T): number {
  const diff = b.score - a.score;
  if (Math.abs(diff) > 1e-6) return diff;
  const costDiff = a.averageCostUsd - b.averageCostUsd;
  if (Math.abs(costDiff) > 1e-9) return costDiff;
  return a.averageLatencyMs - b.averageLatencyMs;
}
