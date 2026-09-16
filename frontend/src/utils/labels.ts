import type { TaskDomain, TaskComplexity, ModelTier } from '../types';

/** Plain-English names for the classifier's task domains. */
export const DOMAIN_LABEL: Record<TaskDomain, string> = {
  coding:         'Code',
  coding_debug:   'Debugging',
  math:           'Math',
  math_reasoning: 'Math reasoning',
  creative:       'Creative writing',
  general:        'General',
  general_chat:   'Chat',
  research:       'Research',
  summarization:  'Summarization',
  vision:         'Vision',
  multilingual:   'Multilingual',
};

export const COMPLEXITY_LABEL: Record<TaskComplexity, string> = {
  low:    'low',
  medium: 'medium',
  high:   'high',
};

export const TIER_LABEL: Record<ModelTier, string> = {
  cheap:    'cheap',
  balanced: 'mid',
  premium:  'premium',
};

export const PROVIDER_LABEL: Record<string, string> = {
  openrouter: 'OpenRouter',
};

export function providerLabel(id: string): string {
  return PROVIDER_LABEL[id] ?? id;
}

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function ms(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${Math.round(n)} ms`;
}

export function usd(n: number): string {
  if (n === 0) return '$0';
  if (n < 0.001) return `$${n.toFixed(6)}`;
  return `$${n.toFixed(4)}`;
}
