/**
 * requestLog.ts
 *
 * Inserts one row into request_logs after every completed routing decision.
 * Always called fire-and-forget so it never delays the response.
 *
 * The prompt text itself is never stored, only a SHA-256 hash and its length.
 * Identical prompts are still detectable for analytics, but nothing in the
 * table can be turned back into what a user typed.
 */

import { createHash } from 'crypto';
import type { TaskDomain, ModelTier } from '../providers/types';
import { getDb, schema } from '../db';

export interface LogRequestParams {
  prompt:     string;
  modelId:    string;
  provider:   string;
  tier:       ModelTier;
  taskType:   TaskDomain;
  latencyMs:  number;
  confidence: number;
  costUsd:    number;
  escalated:  boolean;
}

function hashPrompt(prompt: string): string {
  return createHash('sha256').update(prompt, 'utf8').digest('hex');
}

export async function logRequest(params: LogRequestParams): Promise<void> {
  await getDb().insert(schema.requestLogs).values({
    promptHash:   hashPrompt(params.prompt),
    promptLength: params.prompt.length,
    modelId:      params.modelId,
    provider:     params.provider,
    tier:         params.tier,
    taskType:     params.taskType,
    latencyMs:    params.latencyMs,
    confidence:   params.confidence,
    costUsd:      params.costUsd,
    escalated:    params.escalated,
  });
}
