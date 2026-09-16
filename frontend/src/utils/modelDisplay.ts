/** Short names for model IDs. Kept in sync with backend/src/config/models.ts. */
export const MODEL_DISPLAY: Record<string, string> = {
  'gpt-4o-mini':                                   'GPT-4o mini',
  'gpt-4o':                                        'GPT-4o',
  'claude-haiku-4-5-20251001':                     'Claude Haiku 4.5',
  'claude-sonnet-4-6':                             'Claude Sonnet 4.6',
  'claude-opus-4-6':                               'Claude Opus 4.6',
  'Qwen/Qwen2.5-7B-Instruct-Turbo':                'Qwen 2.5 7B',
  'meta-llama/Llama-4-Maverick-17B-128E-Instruct': 'Llama 4 Maverick',
  'Qwen/Qwen2.5-72B-Instruct-Turbo':               'Qwen 2.5 72B',
  'meta-llama/Llama-3.3-70B-Instruct-Turbo':       'Llama 3.3 70B',
  'deepseek-ai/DeepSeek-V3':                       'DeepSeek V3',
  'llama-3.1-8b-instant':                          'Llama 3.1 8B',
  'llama-3.3-70b-versatile':                       'Llama 3.3 70B',
};

/** Returns a short display name for a model ID, falling back to the last path segment. */
export function modelDisplayName(modelId: string): string {
  return MODEL_DISPLAY[modelId] ?? modelId.split('/').pop() ?? modelId;
}
