/**
 * performanceStore.ts
 *
 * Persistent performance tracking in Postgres.
 *
 * Each row in `performance_stats` is one (model_id, task_type) bucket.
 * Averages are updated atomically by the `record_performance` SQL function
 * (backend/drizzle/*_record_performance.sql), which takes the EMA smoothing
 * factor `p_alpha` from config.emaAlpha.
 *
 * All public methods are async. Callers that don't need to await the write
 * (e.g. hot-path routing) should fire-and-forget with a `.catch()` handler.
 *
 * Scoring: do NOT add a scoring function here. StrategyEngine owns scoring
 * (strategyEngine.scoreStats / strategyEngine.rankStats). Duplicating it with
 * different weights causes the UI and the router to disagree on which
 * provider is "best".
 */

import type { TaskDomain, ModelTier } from '../providers/types';
import { and, eq, sql } from 'drizzle-orm';
import { getDb, schema } from '../db';
import { config } from '../config';

// ---------------------------------------------------------------------------
// Public types (unchanged from in-memory version — same interface)
// ---------------------------------------------------------------------------

export interface RecordResultParams {
  /** Canonical model ID (e.g. "meta-llama/Llama-3.3-70B-Instruct"). Primary key. */
  modelId:    string;
  /** Provider name — stored denormalized for display queries. */
  provider:   string;
  /** Capability tier — stored denormalized for display queries. */
  tier:       ModelTier;
  taskType:   TaskDomain;
  latencyMs:  number;
  /** 0–1: model-reported or tier-simulated confidence in response quality. */
  confidence: number;
  /** True when this call's confidence fell below threshold, triggering escalation. */
  escalated:  boolean;
  costUsd:    number;
}

export interface PerformanceStats {
  /** Canonical model ID — primary key dimension replacing (provider, tier). */
  modelId:           string;
  /** Provider name — kept for display and fallback resolution. */
  provider:          string;
  /** Capability tier — kept for display and exploration constraints. */
  tier:              ModelTier;
  taskType:          TaskDomain;
  totalRequests:     number;
  averageLatencyMs:  number;
  averageConfidence: number;
  /** Fraction of calls that triggered escalation (0–1). */
  escalationRate:    number;
  averageCostUsd:    number;
}

// ---------------------------------------------------------------------------
// PerformanceStore
// ---------------------------------------------------------------------------

export class PerformanceStore {

  // ── Write ─────────────────────────────────────────────────────────────────

  /**
   * Record the outcome of a single provider call.
   *
   * Calls the `record_performance` SQL function, which upserts the running
   * averages in one statement so concurrent calls can't race each other.
   *
   * Call once for the initial model and, if escalation occurred, once more
   * for the final model (with escalated: false for that second call).
   */
  async recordResult(params: RecordResultParams): Promise<void> {
    const { modelId, provider, tier, taskType, latencyMs, confidence, escalated, costUsd } = params;

    try {
      await getDb().execute(sql`
        SELECT record_performance(
          ${modelId}, ${provider}, ${tier}, ${taskType},
          ${latencyMs}::double precision, ${confidence}::double precision,
          ${escalated}::boolean, ${costUsd}::double precision,
          ${config.emaAlpha}::double precision
        )`);
    } catch (err) {
      throw new Error(`PerformanceStore.recordResult failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Read ──────────────────────────────────────────────────────────────────

  /**
   * Return computed stats for a specific (modelId, taskType) pair.
   * Returns null if no data has been recorded for this combination yet.
   */
  async getStats(
    modelId:  string,
    taskType: TaskDomain,
  ): Promise<PerformanceStats | null> {
    const rows = await getDb()
      .select()
      .from(schema.performanceStats)
      .where(and(eq(schema.performanceStats.modelId, modelId), eq(schema.performanceStats.taskType, taskType)))
      .limit(1);
    return rows[0] ? this.toStats(rows[0]) : null;
  }

  /**
   * Return computed stats for every recorded bucket, optionally filtered
   * by taskType. Rows with zero requests are never inserted, so every
   * returned entry has at least one data point.
   */
  async getAllStats(taskType?: TaskDomain): Promise<PerformanceStats[]> {
    // LIMIT bounds the result set to at most 2× the model registry size,
    // preventing unbounded reads as the performance table grows.
    const STATS_LIMIT = 200;

    const base = getDb().select().from(schema.performanceStats);
    const rows = taskType !== undefined
      ? await base.where(eq(schema.performanceStats.taskType, taskType)).limit(STATS_LIMIT)
      : await base.limit(STATS_LIMIT);

    return rows.map(row => this.toStats(row));
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private toStats(row: typeof schema.performanceStats.$inferSelect): PerformanceStats {
    return {
      modelId:           row.modelId,
      provider:          row.provider,
      tier:              row.tier as ModelTier,
      taskType:          row.taskType as TaskDomain,
      totalRequests:     row.totalRequests,
      averageLatencyMs:  row.avgLatencyMs,
      averageConfidence: row.avgConfidence,
      escalationRate:    row.escalationRate,
      averageCostUsd:    row.avgCostUsd,
    };
  }

}

export const performanceStore = new PerformanceStore();
