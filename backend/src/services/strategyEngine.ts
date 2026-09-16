import type { TaskDomain, TaskComplexity, ModelTier } from '../providers/types';
import type { ResolvedModel } from '../providers/providerManager';
import { providerManager } from '../providers';
import { performanceStore, type PerformanceStats } from './performanceStore';
import { MODEL_REGISTRY } from '../config/models';
import { logger } from '../utils/logger';

import {
  DEFAULT_TASK_WEIGHTS,
  EXPLORATION_TIERS,
  applyOverrides,
  scoreStats,
  compareScored,
  type TaskWeights,
  type OptimizationMode,
  type WeightOverrideConfig,
} from './scoring';

export { DEFAULT_TASK_WEIGHTS } from './scoring';
export type { TaskWeights, OptimizationMode, WeightOverrideConfig } from './scoring';

// Format: CODE_WEIGHTS=confidence:2.0,cost:0.5,latency:0.2,escalation:1.0
function parseWeightsEnv(envVar: string | undefined): Partial<TaskWeights> | null {
  if (!envVar) return null;
  const result: Partial<TaskWeights> = {};
  for (const part of envVar.split(',')) {
    const [key, val] = part.trim().split(':');
    const num = parseFloat(val ?? '');
    if (!isFinite(num) || num < 0) continue;
    if (key === 'confidence') result.confidenceWeight = num;
    if (key === 'cost')       result.costWeight       = num;
    if (key === 'latency')    result.latencyWeight    = num;
    if (key === 'escalation') result.escalationWeight = num;
  }
  return Object.keys(result).length > 0 ? result : null;
}

function buildEffectiveWeights(): Record<TaskDomain, TaskWeights> {
  const envMap: Record<TaskDomain, string | undefined> = {
    coding:        process.env.CODE_WEIGHTS,
    coding_debug:  process.env.CODING_DEBUG_WEIGHTS,
    math:          process.env.MATH_WEIGHTS,
    math_reasoning: process.env.MATH_REASONING_WEIGHTS,
    creative:      process.env.CREATIVE_WEIGHTS,
    research:      process.env.RESEARCH_WEIGHTS,
    summarization: process.env.SUMMARIZATION_WEIGHTS,
    vision:        process.env.VISION_WEIGHTS,
    general:       process.env.GENERAL_WEIGHTS,
    general_chat:  process.env.GENERAL_CHAT_WEIGHTS,
    multilingual:  process.env.MULTILINGUAL_WEIGHTS,
  };
  const result = Object.fromEntries(
    Object.entries(DEFAULT_TASK_WEIGHTS).map(([k, v]) => [k, { ...v }]),
  ) as Record<TaskDomain, TaskWeights>;
  for (const [domain, envVal] of Object.entries(envMap) as [TaskDomain, string | undefined][]) {
    const overrides = parseWeightsEnv(envVal);
    if (overrides) result[domain] = { ...result[domain], ...overrides };
  }
  return result;
}

const EFFECTIVE_WEIGHTS = buildEffectiveWeights();

export interface StrategyDecision {
  resolved: ResolvedModel;
  winningStats: PerformanceStats | null;
  score: number | null;
  usedFallback: boolean;
  explored: boolean;
  rankedOptions: Array<PerformanceStats & { score: number }>;
}

export class StrategyEngine {
  readonly epsilon: number;

  constructor(epsilon = 0.1) {
    this.epsilon = epsilon;
  }

  resolveWeights(taskType: TaskDomain, override?: WeightOverrideConfig): TaskWeights {
    return applyOverrides(EFFECTIVE_WEIGHTS[taskType], override);
  }

  async choose(
    taskType: TaskDomain,
    complexity: TaskComplexity,
    override?: WeightOverrideConfig,
  ): Promise<StrategyDecision> {
    let candidates: PerformanceStats[];
    try {
      candidates = await performanceStore.getAllStats(taskType);
    } catch (err) {
      logger.warn('StrategyEngine.choose: performance store unavailable, using static routing fallback', {
        taskType, error: err instanceof Error ? err.message : String(err),
      });
      return {
        resolved:      providerManager.resolve(taskType, complexity),
        winningStats:  null,
        score:         null,
        usedFallback:  true,
        explored:      false,
        rankedOptions: [],
      };
    }

    if (candidates.length === 0) {
      return {
        resolved:      providerManager.resolve(taskType, complexity),
        winningStats:  null,
        score:         null,
        usedFallback:  true,
        explored:      false,
        rankedOptions: [],
      };
    }

    const weights = this.resolveWeights(taskType, override);
    // Ties (within floating-point noise) break on lower cost, then lower
    // latency, so DB insertion order never decides.
    const rankedOptions = candidates
      .map(s => ({ ...s, score: scoreStats(s, weights) }))
      .sort(compareScored);

    if (Math.random() < this.epsilon) {
      return { ...this.exploreRandom(taskType, complexity), rankedOptions };
    }

    return { ...this.exploit(candidates, weights, taskType, complexity), rankedOptions };
  }

  async rankStats(
    taskType: TaskDomain,
    override?: WeightOverrideConfig,
  ): Promise<Array<PerformanceStats & { score: number }>> {
    const stats = await performanceStore.getAllStats(taskType);
    const weights = this.resolveWeights(taskType, override);
    return stats
      .map(s => ({ ...s, score: scoreStats(s, weights) }))
      .sort(compareScored);
  }

  private exploreRandom(taskType: TaskDomain, complexity: TaskComplexity): Omit<StrategyDecision, 'rankedOptions'> {
    // Build exploration pool from model registry, constrained to tiers valid
    // for the task complexity. This gives per-model granularity during exploration
    // instead of per-(provider, tier) pairs.
    const validTiers = EXPLORATION_TIERS[complexity];
    const pool = MODEL_REGISTRY.filter(m => (validTiers as readonly ModelTier[]).includes(m.tier));

    // Guard: if no models match the tier constraint (misconfigured registry),
    // fall back to the default routing decision rather than crashing on
    // an undefined index access.
    if (pool.length === 0) {
      return {
        resolved:     providerManager.resolve(taskType, complexity),
        winningStats: null,
        score:        null,
        usedFallback: true,
        explored:     false,
      };
    }

    const pick = pool[Math.floor(Math.random() * pool.length)];
    const resolved = providerManager.resolveByModelId(
      pick.id,
      `Exploration (ε=${this.epsilon}): ${pick.displayName} (${pick.tier}) for ${taskType}`,
    );

    return { resolved, winningStats: null, score: null, usedFallback: false, explored: true };
  }

  private exploit(
    candidates:  PerformanceStats[],
    weights:     TaskWeights,
    taskType:    TaskDomain,
    complexity:  TaskComplexity,
  ): Omit<StrategyDecision, 'rankedOptions'> {
    // Sort descending by score so we try the best candidate first.
    const ranked = [...candidates]
      .map(s => ({ ...s, score: scoreStats(s, weights) }))
      .sort(compareScored);

    for (const w of ranked) {
      const bestScore = w.score;
      try {
        const resolved = providerManager.resolveByModelId(
          w.modelId,
          `Strategy: ${w.modelId} scored ${bestScore.toFixed(3)} ` +
          `(conf ${(w.averageConfidence * 100).toFixed(0)}%, ` +
          `esc ${(w.escalationRate * 100).toFixed(0)}%, ` +
          `${Math.round(w.averageLatencyMs)} ms, ` +
          `$${w.averageCostUsd.toFixed(6)})`,
        );
        return { resolved, winningStats: w, score: bestScore, usedFallback: false, explored: false };
      } catch {
        // Model ID is stale (removed from registry or provider no longer registered).
        // Log once and try the next-best candidate rather than surfacing a 500.
        logger.warn('StrategyEngine.exploit: skipping stale model ID', {
          modelId: w.modelId, taskType,
        });
      }
    }

    // All performance candidates are stale — fall back to static routing.
    logger.warn('StrategyEngine.exploit: all candidates stale, using static routing fallback', { taskType });
    return {
      resolved:     providerManager.resolve(taskType, complexity),
      winningStats: null,
      score:        null,
      usedFallback: true,
      explored:     false,
    };
  }


}

export const strategyEngine = new StrategyEngine();
