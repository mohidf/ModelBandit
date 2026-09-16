/**
 * openrouterProvider.ts
 *
 * OpenRouter — one API key for open-weight models from many hosts.
 * Base URL: https://openrouter.ai/api/v1, OpenAI-compatible, so this reuses
 * the OpenAI SDK with a custom baseURL. Error handling, timeouts and response
 * parsing match openaiProvider.ts.
 *
 * Model IDs are OpenRouter's (e.g. "meta-llama/llama-3.3-70b-instruct").
 * OpenRouter picks the cheapest healthy upstream for each, which is why this
 * replaced a single-vendor provider: a model being withdrawn by one host no
 * longer breaks routing.
 */

import OpenAI from 'openai';
import type { IProvider, GenerateOptions, GenerateResult, CostEstimate } from './baseProvider';
import type { ModelTier } from './types';
import { MODEL_REGISTRY } from '../config/models';

const BASE_URL   = 'https://openrouter.ai/api/v1';
// OpenRouter's larger models can take a while under load; a timeout is
// treated as a provider failure and the router falls back (see router.ts).
const TIMEOUT_MS = 60_000;

// OpenRouter asks for these so the app shows up in their dashboard. Optional.
const DEFAULT_HEADERS = {
  'HTTP-Referer': 'https://github.com/mohidf/ModelBandit',
  'X-Title':      'ModelBandit',
};

// Prices come from the model registry (USD per 1k tokens), so there is one
// place to update when OpenRouter's pricing page changes.
const FALLBACK_PER_1K = { input: 0.0005, output: 0.0015 };

let _client: OpenAI | null = null;

function makeClient(apiKey: string): OpenAI {
  return new OpenAI({ apiKey, baseURL: BASE_URL, maxRetries: 2, defaultHeaders: DEFAULT_HEADERS });
}

function getClient(): OpenAI {
  if (!_client) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error(
        'OpenRouterProvider: OPENROUTER_API_KEY is not set. ' +
        'Add it to your .env file. Obtain a key at https://openrouter.ai/keys',
      );
    }
    _client = makeClient(apiKey);
  }
  return _client;
}

export class OpenRouterProvider implements IProvider {
  readonly name = 'openrouter' as const;

  async generate(prompt: string, model: string, options: GenerateOptions): Promise<GenerateResult> {
    const { tier, maxTokens, apiKey } = options;
    // Use a per-request client when the caller supplies their own key.
    const client = apiKey ? makeClient(apiKey) : getClient();
    const start  = Date.now();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const completion = await client.chat.completions.create(
        { model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] },
        { signal: controller.signal },
      );

      // OpenRouter can answer 200 with an error body and no choices.
      const choice = completion.choices?.[0];
      if (!choice) {
        const detail = (completion as unknown as { error?: { message?: string } }).error?.message ?? 'no choices in response';
        throw new Error(`OpenRouterProvider [${model}]: ${detail}`);
      }

      return {
        text:            choice.message.content ?? '',
        inputTokens:     completion.usage?.prompt_tokens     ?? 0,
        outputTokens:    completion.usage?.completion_tokens ?? 0,
        latencyMs:       Date.now() - start,
        model,
        provider:        this.name,
        tier,
        modelConfidence: 1.0,
      };
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new Error(`OpenRouterProvider: request to ${model} timed out after ${TIMEOUT_MS} ms`);
      }
      if (err instanceof OpenAI.APIError) {
        throw new Error(`OpenRouterProvider [${model}]: API error ${err.status} — ${err.message}`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  estimateCost(model: string, _tier: ModelTier, inputTokens: number, outputTokens: number): CostEstimate {
    const price = MODEL_REGISTRY.find(m => m.id === model)?.costPer1kTokens ?? FALLBACK_PER_1K;
    const inputCostUsd  = inputTokens  * price.input  / 1_000;
    const outputCostUsd = outputTokens * price.output / 1_000;
    return { inputCostUsd, outputCostUsd, tierMultiplier: 1, totalCostUsd: inputCostUsd + outputCostUsd };
  }
}

export const openrouterProvider = new OpenRouterProvider();
