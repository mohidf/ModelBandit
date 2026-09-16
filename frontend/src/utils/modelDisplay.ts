/** Short names for model IDs. Kept in sync with backend/src/config/models.ts. */
export const MODEL_DISPLAY: Record<string, string> = {
  'openai/gpt-4o-mini':                            'GPT-4o mini',
  'openai/gpt-4o':                                 'GPT-4o',
  'anthropic/claude-haiku-4.5':                    'Claude Haiku 4.5',
  'anthropic/claude-sonnet-4.6':                   'Claude Sonnet 4.6',
  'anthropic/claude-opus-4.6':                     'Claude Opus 4.6',
  'meta-llama/llama-3.1-8b-instruct':              'Llama 3.1 8B',
  'meta-llama/llama-3.3-70b-instruct':             'Llama 3.3 70B',
  'qwen/qwen-2.5-72b-instruct':                    'Qwen 2.5 72B',
  'meta-llama/llama-4-scout':                      'Llama 4 Scout',
  'deepseek/deepseek-v3.2':                        'DeepSeek V3.2',
  'qwen/qwen3-235b-a22b':                          'Qwen3 235B',
  'meta-llama/llama-4-maverick':                   'Llama 4 Maverick',
};

/** Returns a short display name for a model ID, falling back to the last path segment. */
export function modelDisplayName(modelId: string): string {
  return MODEL_DISPLAY[modelId] ?? modelId.split('/').pop() ?? modelId;
}
