/**
 * routing.ts — the static routing table and the complexity → tier map.
 *
 * Both are plain data with no provider imports, so the browser demo can show
 * the same fallback decision the server makes when there is no performance
 * history for a task type. providers/index.ts wires this table to real
 * provider instances.
 */

import type { TaskDomain, TaskComplexity, ModelTier } from '../providers/types';

/**
 * A single routing decision: which registered provider to use for a domain,
 * plus an optional fallback provider for cross-provider escalation.
 */
export interface DomainRoute {
  /** Must match IProvider.name of a registered provider. */
  providerName: string;
  /**
   * Provider to escalate to when already at premium and confidence is low.
   * If omitted or the same as providerName, cross-provider escalation is skipped.
   */
  fallbackProviderName?: string;
  /** Shown to the caller explaining why this provider was chosen. */
  reason: string;
}

/** Full routing table, one entry per domain. */
export type RoutingConfig = Record<TaskDomain, DomainRoute>;

/**
 * Maps task complexity (classifier output) to provider tier (capability level).
 *
 * High complexity maps to `balanced` (not `premium`) so the strategy engine
 * accumulates data for balanced-tier models on first encounters. If classifier
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

/** Model each provider uses at each tier. Mirrors the register() calls in providers/index.ts. */
export const PROVIDER_TIERS: Record<string, Record<ModelTier, string>> = {
  openai: {
    cheap:    'gpt-4o-mini',
    balanced: 'gpt-4o-mini',  // OpenAI has no mid-tier model; escalation promotes to premium (gpt-4o)
    premium:  'gpt-4o',
  },
  anthropic: {
    cheap:    'claude-haiku-4-5-20251001',
    balanced: 'claude-sonnet-4-6',
    premium:  'claude-opus-4-6',
  },
  openrouter: {
    cheap:    'meta-llama/llama-3.1-8b-instruct',
    balanced: 'meta-llama/llama-3.3-70b-instruct',
    premium:  'deepseek/deepseek-v3.2',
  },
};

// OpenRouter is the default provider for most domains (open-weight models,
// strong cost efficiency). OpenAI and Anthropic remain as fallbacks and
// primary providers for domains where they clearly excel.
export const ROUTING: RoutingConfig = {
  coding: {
    providerName:         'openrouter',
    fallbackProviderName: 'openai',
    reason: 'OpenRouter Llama / DeepSeek for structured code generation',
  },
  math: {
    providerName:         'openrouter',
    fallbackProviderName: 'openai',
    reason: 'OpenRouter Llama 70B / DeepSeek for mathematical reasoning',
  },
  creative: {
    providerName:         'openrouter',
    fallbackProviderName: 'anthropic',
    reason: 'OpenRouter Llama 3.3 70B / Llama 3.1 8B for creative writing',
  },
  general: {
    providerName:         'openrouter',
    fallbackProviderName: 'openai',
    reason: 'OpenRouter Llama 3.1 8B for cost-efficient general-purpose queries',
  },
  research: {
    providerName:         'anthropic',
    fallbackProviderName: 'openrouter',
    reason: 'Claude excels at long-context research synthesis and citations',
  },
  summarization: {
    providerName:         'openrouter',
    fallbackProviderName: 'openai',
    reason: 'OpenRouter Llama 3.1 8B for cost-effective text compression',
  },
  vision: {
    providerName:         'openrouter',
    fallbackProviderName: 'openai',
    reason: 'OpenRouter Llama 4 Scout / Maverick for image and visual understanding',
  },
  coding_debug: {
    providerName:         'openrouter',
    fallbackProviderName: 'openai',
    reason: 'OpenRouter DeepSeek / Llama 70B for debugging and error analysis',
  },
  general_chat: {
    providerName:         'openrouter',
    fallbackProviderName: 'openai',
    reason: 'OpenRouter Llama 3.1 8B for low-latency conversational queries',
  },
  multilingual: {
    providerName:         'openrouter',
    fallbackProviderName: 'anthropic',
    reason: 'OpenRouter Qwen 72B / Llama 70B with strong multilingual capabilities',
  },
  math_reasoning: {
    providerName:         'openrouter',
    fallbackProviderName: 'openai',
    reason: 'OpenRouter Llama 3.3 70B / DeepSeek for chain-of-thought mathematical reasoning',
  },
};
