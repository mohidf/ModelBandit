/**
 * providerManager.test.ts
 *
 * ProviderManager is pure in-memory logic: no network, no DB. A mock
 * provider named 'openrouter' stands in for the real one, since every model
 * in the registry belongs to it. The routing table is a test fixture built
 * from real registry IDs.
 */

import { ProviderManager } from '../providers/providerManager';
import type { RoutingConfig } from '../providers/providerManager';
import type { IProvider, GenerateOptions, GenerateResult, CostEstimate } from '../providers/baseProvider';
import type { ModelTier } from '../providers/types';
import { ALL_DOMAINS } from '../providers/types';

function makeProvider(name: string): IProvider {
  return {
    name,
    async generate(_prompt: string, model: string, options: GenerateOptions): Promise<GenerateResult> {
      return {
        text: `response from ${name}/${model}`,
        inputTokens: 10, outputTokens: 20,
        latencyMs: 100, model, provider: name,
        tier: options.tier, modelConfidence: 1.0,
      };
    },
    estimateCost(_model: string, _tier: ModelTier, _input: number, _output: number): CostEstimate {
      return { inputCostUsd: 0.001, outputCostUsd: 0.002, tierMultiplier: 1, totalCostUsd: 0.003 };
    },
  };
}

const CHEAP    = 'meta-llama/llama-3.1-8b-instruct';
const MID      = 'meta-llama/llama-3.3-70b-instruct';
const PREMIUM  = 'deepseek/deepseek-v3.2';
const ESCALATE = 'openai/gpt-4o';

const OPEN = { cheap: CHEAP, balanced: MID, premium: PREMIUM };

const ROUTING: RoutingConfig = Object.fromEntries(
  ALL_DOMAINS.map(d => [d, { models: OPEN, escalateTo: ESCALATE, reason: `route for ${d}` }]),
) as RoutingConfig;
// creative has no escalateTo; research uses a different ladder.
ROUTING.creative = { models: OPEN, reason: 'route for creative' };
ROUTING.research = {
  models: { cheap: 'anthropic/claude-haiku-4.5', balanced: 'anthropic/claude-sonnet-4.6', premium: 'anthropic/claude-opus-4.6' },
  escalateTo: ESCALATE,
  reason: 'route for research',
};

function buildManager(): ProviderManager {
  return new ProviderManager(ROUTING).register(makeProvider('openrouter'));
}

// ─────────────────────────────────────────────────────────────────────────────

describe('ProviderManager — registration', () => {
  it('lists registered providers', () => {
    expect(buildManager().listProviders()).toEqual(['openrouter']);
  });

  it('throws for an unregistered provider', () => {
    expect(() => buildManager().getProvider('nope')).toThrow(/not registered/);
  });
});

describe('ProviderManager — resolve()', () => {
  it('maps low complexity to the cheap model', () => {
    const r = buildManager().resolve('coding', 'low');
    expect(r.model).toBe(CHEAP);
    expect(r.tier).toBe('cheap');
    expect(r.provider.name).toBe('openrouter');
  });

  it('maps medium and high complexity to the mid tier (premium is reached by escalation)', () => {
    expect(buildManager().resolve('coding', 'medium').model).toBe(MID);
    expect(buildManager().resolve('coding', 'high').model).toBe(MID);
  });

  it('uses the domain-specific ladder', () => {
    expect(buildManager().resolve('research', 'low').model).toBe('anthropic/claude-haiku-4.5');
  });

  it('includes the route reason', () => {
    expect(buildManager().resolve('math', 'low').reason).toBe('route for math');
  });
});

describe('ProviderManager — resolveByModelId()', () => {
  it('resolves a registry model with its registry tier', () => {
    const r = buildManager().resolveByModelId('openai/gpt-4o-mini', 'test reason');
    expect(r.model).toBe('openai/gpt-4o-mini');
    expect(r.tier).toBe('cheap');
    expect(r.reason).toBe('test reason');
  });

  it('throws when the model ID is not in the registry', () => {
    expect(() => buildManager().resolveByModelId('nonexistent-model-xyz', 't')).toThrow(/nonexistent-model-xyz/);
  });

  it('throws when the provider for a registry model is not registered', () => {
    const empty = new ProviderManager(ROUTING);
    expect(() => empty.resolveByModelId(CHEAP, 't')).toThrow(/openrouter/);
  });
});

describe('ProviderManager — escalate()', () => {
  it('goes one tier up within the domain ladder', () => {
    const m = buildManager();
    const fromCheap = m.escalate(m.resolve('coding', 'low'), 'coding');
    expect(fromCheap?.model).toBe(MID);
    expect(fromCheap?.tier).toBe('balanced');
    const fromMid = m.escalate(fromCheap!, 'coding');
    expect(fromMid?.model).toBe(PREMIUM);
    expect(fromMid?.tier).toBe('premium');
  });

  it('goes to escalateTo when already at premium', () => {
    const m = buildManager();
    const atPremium = m.resolveByModelId(PREMIUM, 't');
    const next = m.escalate(atPremium, 'coding');
    expect(next?.model).toBe(ESCALATE);
    expect(next?.tier).toBe('premium');
  });

  it('returns null at premium when the domain has no escalateTo', () => {
    const m = buildManager();
    expect(m.escalate(m.resolveByModelId(PREMIUM, 't'), 'creative')).toBeNull();
  });

  it('returns null when already on the escalateTo model', () => {
    const m = buildManager();
    expect(m.escalate(m.resolveByModelId(ESCALATE, 't'), 'coding')).toBeNull();
  });
});

describe('ProviderManager — fallback()', () => {
  it('prefers the domain ladder model at the same tier', () => {
    const m = buildManager();
    const failed = m.resolveByModelId('openai/gpt-4o-mini', 't');   // cheap, not the ladder's cheap model
    const alt = m.fallback(failed, 'coding');
    expect(alt?.model).toBe(CHEAP);
    expect(alt?.tier).toBe('cheap');
    expect(alt?.reason).toMatch(/after openai\/gpt-4o-mini failed/);
  });

  it('picks another registry model of the same tier when the ladder model is the one that failed', () => {
    const m = buildManager();
    const alt = m.fallback(m.resolve('coding', 'low'), 'coding');
    expect(alt).not.toBeNull();
    expect(alt!.model).not.toBe(CHEAP);
    expect(alt!.tier).toBe('cheap');
  });

  it('never returns the model that failed', () => {
    const m = buildManager();
    for (const tier of ['cheap', 'balanced', 'premium'] as const) {
      const failed = m.resolve('research', tier === 'cheap' ? 'low' : 'medium');
      const alt = m.fallback({ ...failed, tier }, 'research');
      if (alt) expect(alt.model).not.toBe(failed.model);
    }
  });
});

describe('ProviderManager — dispatch()', () => {
  it('passes the user key for the model provider and prices the result', async () => {
    const provider = makeProvider('openrouter');
    const spy = jest.spyOn(provider, 'generate');
    const m = new ProviderManager(ROUTING).register(provider);
    const { result, cost } = await m.dispatch(m.resolve('coding', 'low'), 'hi', {
      maxTokens: 50, userApiKeys: { openrouter: 'sk-user' },
    });
    expect(spy).toHaveBeenCalledWith('hi', CHEAP, { maxTokens: 50, tier: 'cheap', apiKey: 'sk-user' });
    expect(result.text).toContain(CHEAP);
    expect(cost.totalCostUsd).toBe(0.003);
  });
});
