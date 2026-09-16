/**
 * providerManager.ts
 *
 * A self-contained service that owns:
 *   - a runtime registry of IProvider instances keyed by provider name
 *   - an injected routing config (provider names, not objects)
 *   - resolution of (domain, complexity) → provider + model + tier
 *   - two-step escalation: higher tier within same provider first,
 *     then cross-provider fallback when already at premium
 *
 * Nothing here imports a specific provider — all coupling is by name.
 * The composition root (index.ts) wires providers into the manager.
 */

import type { IProvider, GenerateOptions, GenerateResult, CostEstimate } from './baseProvider';
import type { TaskDomain, TaskComplexity, ModelTier } from './types';
import { getModelById } from '../config/models';

import { COMPLEXITY_TO_TIER, type DomainRoute, type RoutingConfig } from '../config/routing';

export type { DomainRoute, RoutingConfig };

function complexityToTier(complexity: TaskComplexity): ModelTier {
  return COMPLEXITY_TO_TIER[complexity];
}

/** Returns the next capability tier above the given one. */
function nextTier(tier: ModelTier): ModelTier {
  if (tier === 'cheap') return 'balanced';
  return 'premium'; // balanced → premium
}

// ---------------------------------------------------------------------------
// Tier map — each provider declares its models by tier
// ---------------------------------------------------------------------------

/**
 * Maps a capability tier to the canonical model ID a provider uses for it.
 * Defined once per provider at registration time.
 *
 * Example (Anthropic):
 *   { cheap: 'claude-haiku-4-5-20251001', balanced: 'claude-sonnet-4-6', premium: 'claude-opus-4-6' }
 */
export interface ModelTierMap {
  cheap:    string;
  balanced: string;
  premium:  string;
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

/** What the router receives after resolution — no model names visible to router. */
export interface ResolvedModel {
  provider: IProvider;
  model:    string;
  /** Capability tier selected — drives latency, depth, confidence, and cost. */
  tier:     ModelTier;
  reason:   string;
}

/** Returned by listProviders() — safe to serialise over the wire. */
export interface ProviderInfo {
  name:  string;
  tiers: ModelTierMap;
}

/** Returned by dispatch() — collapses generate + estimateCost into one call. */
export interface DispatchResult {
  result: GenerateResult;
  cost:   CostEstimate;
}

// ---------------------------------------------------------------------------
// ProviderManager
// ---------------------------------------------------------------------------

export class ProviderManager {
  private readonly registry = new Map<string, { provider: IProvider; tiers: ModelTierMap }>();

  constructor(private readonly routing: RoutingConfig) {}

  // ── Registration ──────────────────────────────────────────────────────────

  /**
   * Register a provider along with its tier→model map.
   * Returns `this` so calls can be chained:
   *   manager.register(openai, { cheap: '...', balanced: '...', premium: '...' })
   *          .register(anthropic, { ... })
   */
  register(provider: IProvider, tiers: ModelTierMap): this {
    this.registry.set(provider.name, { provider, tiers });
    return this;
  }

  // ── Registry queries ──────────────────────────────────────────────────────

  /** Fetch a registered provider by name. Throws if not registered. */
  getProvider(name: string): IProvider {
    return this.entry(name).provider;
  }

  /** Return the tier→model map for a registered provider. */
  getTiers(providerName: string): Readonly<ModelTierMap> {
    return this.entry(providerName).tiers;
  }

  /** Names and tier maps of all registered providers. Safe to serialise. */
  listProviders(): ProviderInfo[] {
    return Array.from(this.registry.entries()).map(([name, { tiers }]) => ({ name, tiers }));
  }

  // ── Routing ───────────────────────────────────────────────────────────────

  /**
   * Resolve the best provider + model + tier for a domain and complexity level.
   * Provider is selected by domain; tier is selected by complexity.
   */
  resolve(domain: TaskDomain, complexity: TaskComplexity): ResolvedModel {
    const { providerName, reason } = this.routing[domain];
    const tier = complexityToTier(complexity);
    return this.build(providerName, tier, reason);
  }

  /**
   * Build a ResolvedModel for an explicit (providerName, tier) pair, bypassing
   * the routing config. Used by StrategyEngine when performance data overrides
   * the default routing decision.
   *
   * Throws if providerName is not registered.
   */
  resolveExplicit(providerName: string, tier: ModelTier, reason: string): ResolvedModel {
    return this.build(providerName, tier, reason);
  }

  /**
   * Compute the escalation target for a resolved model.
   *
   * Escalation strategy:
   *   1. If not yet at premium → upgrade to the next tier within the same provider.
   *   2. If already at premium → switch to the domain's fallback provider (premium).
   *   3. If already at premium and no fallback (or fallback === current) → return null.
   *
   * The router should call dispatch() only when this returns non-null.
   */
  escalate(resolved: ResolvedModel, domain: TaskDomain): ResolvedModel | null {
    const route = this.routing[domain];

    if (resolved.tier !== 'premium') {
      // Same provider, one tier higher
      const next = nextTier(resolved.tier);
      return this.build(
        resolved.provider.name,
        next,
        `Escalated to ${next} tier: ${route.reason}`,
      );
    }

    // Already at premium — attempt cross-provider escalation
    const { fallbackProviderName } = route;
    if (fallbackProviderName && fallbackProviderName !== resolved.provider.name) {
      return this.build(
        fallbackProviderName,
        'premium',
        `Escalated to ${fallbackProviderName} (premium, fallback provider): ${route.reason}`,
      );
    }

    // No escalation possible
    return null;
  }

  /**
   * Where to send a request when the resolved provider fails outright
   * (timeout, auth error, out of credit): the domain's fallback provider at
   * the same tier. Returns null when there is no different fallback provider.
   */
  fallback(resolved: ResolvedModel, domain: TaskDomain): ResolvedModel | null {
    const { fallbackProviderName, reason } = this.routing[domain];
    if (!fallbackProviderName || fallbackProviderName === resolved.provider.name) return null;
    return this.build(
      fallbackProviderName,
      resolved.tier,
      `Fallback to ${fallbackProviderName} after ${resolved.provider.name} failed: ${reason}`,
    );
  }

  // ── Dispatch ─────────────────────────────────────────────────────────────

  /**
   * Run a full provider call (generate + estimateCost) for an already-resolved
   * model. Injects tier into GenerateOptions so providers never infer it from
   * the model string. Keeps the router free from calling provider methods directly.
   *
   * When `userApiKeys` is supplied, the matching provider key (if present) is
   * forwarded to the provider as a per-request override, falling back to the
   * provider's env-var singleton when absent.
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
    const cost   = resolved.provider.estimateCost(
      resolved.model,
      resolved.tier,
      result.inputTokens,
      result.outputTokens,
    );

    return { result, cost };
  }

  /**
   * Resolve a specific model by its canonical ID from the model registry.
   * Used by StrategyEngine when performance data nominates a specific model
   * (rather than a generic provider+tier combination).
   *
   * Throws if the model is not in the registry or its provider is not registered.
   */
  resolveByModelId(modelId: string, reason: string): ResolvedModel {
    const descriptor = getModelById(modelId);
    if (!descriptor) {
      throw new Error(
        `ProviderManager.resolveByModelId: "${modelId}" is not in the model registry.`,
      );
    }
    const { provider } = this.entry(descriptor.provider);
    return { provider, model: modelId, tier: descriptor.tier, reason };
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private entry(name: string): { provider: IProvider; tiers: ModelTierMap } {
    const e = this.registry.get(name);
    if (!e) {
      const registered = [...this.registry.keys()].join(', ') || 'none';
      throw new Error(`Provider "${name}" is not registered. Registered: [${registered}]`);
    }
    return e;
  }

  private build(
    providerName: string,
    tier:         ModelTier,
    reason:       string,
  ): ResolvedModel {
    const { provider, tiers } = this.entry(providerName);
    return { provider, model: tiers[tier], tier, reason };
  }
}
