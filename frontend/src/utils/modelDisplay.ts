/** Short names for model IDs. Kept in sync with backend/src/config/models.ts. */
export const MODEL_DISPLAY: Record<string, string> = {
  'gpt-4o-mini':                                   'GPT-4o mini',
  'gpt-4o':                                        'GPT-4o',
  'claude-haiku-4-5-20251001':                     'Claude Haiku 4.5',
  'claude-sonnet-4-6':                             'Claude Sonnet 4.6',
  'claude-opus-4-6':                               'Claude Opus 4.6',
  'meta-llama/llama-3.1-8b-instruct':              'Llama 3.1 8B',
  'openai/gpt-oss-20b':                            'GPT-OSS 20B',
  'meta-llama/llama-3.3-70b-instruct':             'Llama 3.3 70B',
  'qwen/qwen-2.5-72b-instruct':                    'Qwen 2.5 72B',
  'meta-llama/llama-4-scout':                      'Llama 4 Scout',
  'deepseek/deepseek-v3.2':                        'DeepSeek V3.2',
  'qwen/qwen3-235b-a22b':                          'Qwen3 235B',
  'meta-llama/llama-4-maverick':                   'Llama 4 Maverick',
  'llama-3.1-8b-instant':                          'Llama 3.1 8B',
  'llama-3.3-70b-versatile':                       'Llama 3.3 70B',
};

/** Returns a short display name for a model ID, falling back to the last path segment. */
export function modelDisplayName(modelId: string): string {
  return MODEL_DISPLAY[modelId] ?? modelId.split('/').pop() ?? modelId;
}
