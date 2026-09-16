/**
 * models.ts — Canonical model registry for all supported AI models.
 *
 * This is the single source of truth for model IDs, providers, capabilities,
 * approximate costs, and domain strengths. Every file that needs to resolve
 * a model ID → metadata should import from here.
 *
 * Keep costs in sync with provider pricing pages. Costs are per-1k-tokens
 * (input and output separately) in USD.
 */

import type { TaskDomain, ModelTier } from '../providers/types';

export type ProviderName = 'openai' | 'anthropic' | 'openrouter';

export interface ModelDescriptor {
  /** Canonical API model string (e.g. "meta-llama/Llama-3.3-70B-Instruct"). */
  id:              string;
  provider:        ProviderName;
  /** Short human-readable name for UI display. */
  displayName:     string;
  /** Capability tier — maps to cheap/balanced/premium routing paths. */
  tier:            ModelTier;
  /** Approximate cost per 1 000 tokens (USD). */
  costPer1kTokens: { input: number; output: number };
  /** Maximum context window in tokens. */
  contextWindow:   number;
  /** Task domains this model performs particularly well on. */
  strengths:       readonly TaskDomain[];
}

export const MODEL_REGISTRY: readonly ModelDescriptor[] = [

  // ── OpenAI ────────────────────────────────────────────────────────────────

  {
    id:              'gpt-4o-mini',
    provider:        'openai',
    displayName:     'GPT-4o mini',
    tier:            'cheap',
    costPer1kTokens: { input: 0.00015, output: 0.0006 },
    contextWindow:   128_000,
    strengths:       ['coding', 'general_chat', 'summarization'],
  },
  {
    id:              'gpt-4o',
    provider:        'openai',
    displayName:     'GPT-4o',
    tier:            'premium',
    costPer1kTokens: { input: 0.005, output: 0.015 },
    contextWindow:   128_000,
    strengths:       ['coding', 'coding_debug', 'math', 'research', 'vision'],
  },

  // ── Anthropic ─────────────────────────────────────────────────────────────

  {
    id:              'claude-haiku-4-5-20251001',
    provider:        'anthropic',
    displayName:     'Claude Haiku',
    tier:            'cheap',
    costPer1kTokens: { input: 0.00025, output: 0.00125 },
    contextWindow:   200_000,
    strengths:       ['general_chat', 'summarization'],
  },
  {
    id:              'claude-sonnet-4-6',
    provider:        'anthropic',
    displayName:     'Claude Sonnet',
    tier:            'balanced',
    costPer1kTokens: { input: 0.003, output: 0.015 },
    contextWindow:   200_000,
    strengths:       ['creative', 'research', 'multilingual'],
  },
  {
    id:              'claude-opus-4-6',
    provider:        'anthropic',
    displayName:     'Claude Opus',
    tier:            'premium',
    costPer1kTokens: { input: 0.015, output: 0.075 },
    contextWindow:   200_000,
    strengths:       ['creative', 'research', 'multilingual', 'coding'],
  },

  // ── OpenRouter ────────────────────────────────────────────────────────────
  //
  // Open-weight models through one key. IDs and prices are OpenRouter's
  // (https://openrouter.ai/models). Prices are per 1 000 tokens, USD.

  {
    id:              'meta-llama/llama-3.1-8b-instruct',
    provider:        'openrouter',
    displayName:     'Llama 3.1 8B',
    tier:            'cheap',
    costPer1kTokens: { input: 0.00005, output: 0.00008 },
    contextWindow:   131_072,
    strengths:       ['general_chat', 'general', 'summarization'],
  },
  {
    id:              'openai/gpt-oss-20b',
    provider:        'openrouter',
    displayName:     'GPT-OSS 20B',
    tier:            'cheap',
    costPer1kTokens: { input: 0.00003, output: 0.00013 },
    contextWindow:   131_072,
    strengths:       ['general', 'summarization', 'coding'],
  },
  {
    id:              'meta-llama/llama-3.3-70b-instruct',
    provider:        'openrouter',
    displayName:     'Llama 3.3 70B',
    tier:            'balanced',
    costPer1kTokens: { input: 0.0001, output: 0.00032 },
    contextWindow:   131_072,
    strengths:       ['general', 'creative', 'math_reasoning', 'research'],
  },
  {
    id:              'qwen/qwen-2.5-72b-instruct',
    provider:        'openrouter',
    displayName:     'Qwen 2.5 72B',
    tier:            'balanced',
    costPer1kTokens: { input: 0.00036, output: 0.0004 },
    contextWindow:   32_768,
    strengths:       ['math', 'multilingual', 'coding'],
  },
  {
    id:              'meta-llama/llama-4-scout',
    provider:        'openrouter',
    displayName:     'Llama 4 Scout',
    tier:            'balanced',
    costPer1kTokens: { input: 0.0001, output: 0.0003 },
    contextWindow:   1_310_720,
    strengths:       ['vision', 'general'],
  },
  {
    id:              'deepseek/deepseek-v3.2',
    provider:        'openrouter',
    displayName:     'DeepSeek V3.2',
    tier:            'premium',
    costPer1kTokens: { input: 0.000269, output: 0.0004 },
    contextWindow:   163_840,
    strengths:       ['coding', 'coding_debug', 'math', 'math_reasoning'],
  },
  {
    id:              'qwen/qwen3-235b-a22b',
    provider:        'openrouter',
    displayName:     'Qwen3 235B',
    tier:            'premium',
    costPer1kTokens: { input: 0.000455, output: 0.00182 },
    contextWindow:   131_072,
    strengths:       ['math_reasoning', 'multilingual', 'research'],
  },
  {
    id:              'meta-llama/llama-4-maverick',
    provider:        'openrouter',
    displayName:     'Llama 4 Maverick',
    tier:            'premium',
    costPer1kTokens: { input: 0.000188, output: 0.000652 },
    contextWindow:   1_048_576,
    strengths:       ['vision', 'general', 'research'],
  },
];

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/** Find a model by its canonical API ID. Returns undefined if not in registry. */
export function getModelById(id: string): ModelDescriptor | undefined {
  return MODEL_REGISTRY.find(m => m.id === id);
}

/** Return all models that list the given domain as a strength. */
export function getModelsByStrength(domain: TaskDomain): ModelDescriptor[] {
  return MODEL_REGISTRY.filter(m => m.strengths.includes(domain));
}
