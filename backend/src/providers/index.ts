/**
 * providers/index.ts — Composition root for the provider layer.
 *
 * This is the only file that imports concrete provider classes.
 * Everything else depends on IProvider (interface) or the providerManager
 * singleton exported here.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  To change which provider handles a domain  → edit ROUTING below        │
 * │  To change a model at a tier               → edit the register() call   │
 * │  To add a new provider                     → implement IProvider,       │
 * │                                              register here              │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import { ProviderManager }    from './providerManager';
import { ROUTING, PROVIDER_TIERS } from '../config/routing';
import { claudeProvider }     from './claudeProvider';
import { openaiProvider }     from './openaiProvider';
import { togetherProvider }   from './togetherProvider';

// Routing configuration lives in config/routing.ts (plain data, no provider
// imports) so the browser demo can show the same fallback decisions.

export const providerManager = new ProviderManager(ROUTING)
  .register(openaiProvider,   PROVIDER_TIERS.openai)
  .register(claudeProvider,   PROVIDER_TIERS.anthropic)
  .register(togetherProvider, PROVIDER_TIERS.together);

// ---------------------------------------------------------------------------
// Re-exports — consumers import everything they need from 'providers'
// ---------------------------------------------------------------------------

export { ProviderManager } from './providerManager';
export type {
  ResolvedModel,
  DispatchResult,
  ModelTierMap,
  RoutingConfig,
  DomainRoute,
  ProviderInfo,
} from './providerManager';
export type { IProvider, GenerateOptions, GenerateResult, CostEstimate } from './baseProvider';
export * from './types';
