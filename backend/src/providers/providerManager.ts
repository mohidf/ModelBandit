/**
 * providerManager.ts
 *
 * Owns the runtime registry of providers and turns routing decisions into a
 * concrete (provider, model, tier) to call:
 *   - resolve():        static table lookup for a domain and complexity
 *   - resolveByModelId(): a specific model the strategy engine chose
 *   - escalate():       one tier up, or the domain's escalateTo past premium
 *   - fallback():       a different model at the same tier when a call fails
 *   - dispatch():       make the call and price it
 *
 * Every model lives in config/models.ts and names its provider there; this
 * file never imports a concrete provider class. The composition root
 * (index.ts) registers the provider instances.
 */

import type { IProvider, GenerateOptions, GenerateResult, CostEstimate } from './baseProvider';
import type { TaskDomain, TaskComplexity, ModelTier } from './types';
import { getModelById, MODEL_REGISTRY } from '../config/models';
import { COMPLEXITY_TO_TIER, type DomainRoute, type RoutingConfig } from '../config/routing';

export type { DomainRoute, RoutingConfig };

/** Returns the next capability tier above the given one. */
function nextTier(tier: ModelTier): ModelTier {
  return tier === 'cheap' ? 'balanced' : 'premium';
}

/** What the router receives after resolution. */
export interface ResolvedModel {
  provider: IProvider;
  model:    string;
  /** Capability tier selected — drives latency, depth, confidence, and cost. */
  tier:     ModelTier;
  reason:   string;
}

/** Returned by dispatch() — collapses generate + estimateCost into one call. */
export interface DispatchResult {
  result: GenerateResult;
  cost:   CostEstimate;
}

export class ProviderManager {
  private readonly registry = new Map<string, IProvider>();

  constructor(private readonly routing: RoutingConfig) {}

  // ── Registration ──────────────────────────────────────────────────────────

  /** Register a provider instance. Chainable. */
  register(provider: IProvider): this {
    this.registry.set(provider.name, provider);
    return this;
  }

  /** Fetch a registered provider by name. Throws if not registered. */
  getProvider(name: string): IProvider {
    const p = this.registry.get(name);
    if (!p) {
      const registered = [...this.registry.keys()].join(', ') || 'none';
      throw new Error(`Provider "${name}" is not registered. Registered: [${registered}]`);
    }
    return p;
  }

  /** Names of all registered providers. */
  listProviders(): string[] {
    return [...this.registry.keys()];
  }

  // ── Routing ───────────────────────────────────────────────────────────────

  /** The static table's model for a domain and complexity. */
  resolve(domain: TaskDomain, complexity: TaskComplexity): ResolvedModel {
    const route = this.routing[domain];
    const tier  = COMPLEXITY_TO_TIER[complexity];
    return this.build(route.models[tier], tier, route.reason);
  }

  /**
   * A specific model by its registry ID, as chosen by the strategy engine.
   * Throws if the model is not in the registry or its provider is not registered.
   */
  resolveByModelId(modelId: string, reason: string): ResolvedModel {
    const descriptor = getModelById(modelId);
    if (!descriptor) {
      throw new Error(`ProviderManager.resolveByModelId: "${modelId}" is not in the model registry.`);
    }
    return this.build(modelId, descriptor.tier, reason);
  }

  /**
   * Where to go when classifier confidence is low:
   *   1. not yet at premium → the domain's model one tier up
   *   2. at premium → the domain's escalateTo model, if it's a different one
   *   3. otherwise null: nowhere to go
   */
  escalate(resolved: ResolvedModel, domain: TaskDomain): ResolvedModel | null {
    const route = this.routing[domain];

    if (resolved.tier !== 'premium') {
      const tier = nextTier(resolved.tier);
      return this.build(route.models[tier], tier, `Escalated to ${tier} tier: ${route.reason}`);
    }

    if (route.escalateTo && route.escalateTo !== resolved.model) {
      return this.build(route.escalateTo, 'premium', `Escalated to ${route.escalateTo}: ${route.reason}`);
    }

    return null;
  }

  /**
   * Where to send a request when the call itself fails (timeout, auth error,
   * malformed response): a different model at the same tier. The domain's
   * own model for that tier is preferred, then any registry model of the
   * tier that lists the domain as a strength, then any model of the tier.
   * Returns null if the failed model was the only option.
   */
  fallback(resolved: ResolvedModel, domain: TaskDomain): ResolvedModel | null {
    const route = this.routing[domain];
    const candidates = [
      route.models[resolved.tier],
      ...MODEL_REGISTRY.filter(m => m.tier === resolved.tier && m.strengths.includes(domain)).map(m => m.id),
      ...MODEL_REGISTRY.filter(m => m.tier === resolved.tier).map(m => m.id),
    ];
    const alt = candidates.find(id => id !== resolved.model && getModelById(id) && this.registry.has(getModelById(id)!.provider));
    if (!alt) return null;
    return this.build(alt, resolved.tier, `Fallback to ${alt} after ${resolved.model} failed: ${route.reason}`);
  }

  // ── Dispatch ─────────────────────────────────────────────────────────────

  /**
   * Run a full provider call (generate + estimateCost) for a resolved model.
   * When `userApiKeys` holds a key for the model's provider, it is passed as
   * a per-request override; otherwise the provider uses its env var.
   */
  async dispatch(
    resolved: ResolvedModel,
    prompt:   string,
    options:  { maxTokens: number; userApiKeys?: Record<string, string> },
  ): Promise<DispatchResult> {
    const genOptions: GenerateOptions = {
      maxTokens: options.maxTokens,
      tier:      resolved.tier,
      apiKey:    options.userApiKeys?.[resolved.provider.name],
    };

    const result = await resolved.provider.generate(prompt, resolved.model, genOptions);
    const cost   = resolved.provider.estimateCost(resolved.model, resolved.tier, result.inputTokens, result.outputTokens);
    return { result, cost };
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private build(modelId: string, tier: ModelTier, reason: string): ResolvedModel {
    const descriptor = getModelById(modelId);
    if (!descriptor) {
      throw new Error(`ProviderManager: "${modelId}" is not in the model registry.`);
    }
    return { provider: this.getProvider(descriptor.provider), model: modelId, tier, reason };
  }
}
