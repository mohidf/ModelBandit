/**
 * routing.ts — the static routing table and the complexity → tier map.
 *
 * Plain data with no provider imports, so the browser demo can show the same
 * fallback decision the server makes when there is no performance history
 * for a task type. Every model ID here must exist in config/models.ts.
 */

import type { TaskDomain, TaskComplexity, ModelTier } from '../providers/types';

/** Which model handles a task type at each tier, and where to go past premium. */
export interface DomainRoute {
  models: Record<ModelTier, string>;
  /**
   * Model to try when the request is already at premium and classifier
   * confidence is still low. Optional; without it there is nowhere to go.
   */
  escalateTo?: string;
  /** Shown to the caller explaining why this route exists. */
  reason: string;
}

/** Full routing table, one entry per domain. */
export type RoutingConfig = Record<TaskDomain, DomainRoute>;

/**
 * Maps task complexity (classifier output) to model tier (capability level).
 *
 * High complexity maps to `balanced` (not `premium`) so the strategy engine
 * accumulates data for mid-tier models on first encounters. If classifier
 * confidence falls below `CONFIDENCE_THRESHOLD`, the escalation path promotes
 * to premium automatically. This prevents the cold-start problem where every
 * domain seeds only premium data, causing the strategy engine to exploit
 * premium indefinitely before cheaper tiers are discovered.
 */
export const COMPLEXITY_TO_TIER: Record<TaskComplexity, ModelTier> = {
  low:    'cheap',
  medium: 'balanced',
  high:   'balanced',
};

// The open-weight ladder most task types start on. Cheap enough that
// exploration can afford to try alternatives.
const OPEN = {
  cheap:    'meta-llama/llama-3.1-8b-instruct',
  balanced: 'meta-llama/llama-3.3-70b-instruct',
  premium:  'deepseek/deepseek-v3.2',
} as const;

export const ROUTING: RoutingConfig = {
  coding: {
    models: OPEN, escalateTo: 'openai/gpt-4o',
    reason: 'Llama for everyday code, DeepSeek for hard cases, GPT-4o if still unsure',
  },
  coding_debug: {
    models: OPEN, escalateTo: 'openai/gpt-4o',
    reason: 'DeepSeek and Llama 70B for debugging; GPT-4o as the last resort',
  },
  math: {
    models: OPEN, escalateTo: 'openai/gpt-4o',
    reason: 'Llama 70B and DeepSeek for math; GPT-4o if still unsure',
  },
  math_reasoning: {
    models: OPEN, escalateTo: 'openai/gpt-4o',
    reason: 'Llama 70B and DeepSeek for step-by-step reasoning; GPT-4o if still unsure',
  },
  creative: {
    models: OPEN, escalateTo: 'anthropic/claude-opus-4.6',
    reason: 'Llama for creative writing; Claude Opus if still unsure',
  },
  research: {
    models: {
      cheap:    'anthropic/claude-haiku-4.5',
      balanced: 'anthropic/claude-sonnet-4.6',
      premium:  'anthropic/claude-opus-4.6',
    },
    escalateTo: 'openai/gpt-4o',
    reason: 'Claude for long-context research synthesis and citations',
  },
  summarization: {
    models: OPEN, escalateTo: 'openai/gpt-4o',
    reason: 'Llama 8B for cost-effective text compression',
  },
  vision: {
    models: {
      cheap:    'openai/gpt-4o-mini',
      balanced: 'meta-llama/llama-4-scout',
      premium:  'meta-llama/llama-4-maverick',
    },
    escalateTo: 'openai/gpt-4o',
    reason: 'Models that accept images: GPT-4o mini, Llama 4 Scout and Maverick',
  },
  general: {
    models: OPEN, escalateTo: 'openai/gpt-4o',
    reason: 'Llama 8B for cost-efficient general questions',
  },
  general_chat: {
    models: OPEN, escalateTo: 'openai/gpt-4o-mini',
    reason: 'Llama 8B for low-latency conversation',
  },
  multilingual: {
    models: {
      cheap:    'meta-llama/llama-3.1-8b-instruct',
      balanced: 'qwen/qwen-2.5-72b-instruct',
      premium:  'qwen/qwen3-235b-a22b',
    },
    escalateTo: 'anthropic/claude-sonnet-4.6',
    reason: 'Qwen for its multilingual strength; Claude Sonnet if still unsure',
  },
};
