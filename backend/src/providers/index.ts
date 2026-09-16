/**
 * providers/index.ts — Composition root for the provider layer.
 *
 * Every model goes through OpenRouter, including the OpenAI and Anthropic
 * ones, so there is one provider class and one API key. The routing table
 * (config/routing.ts) and the model registry (config/models.ts) are plain
 * data; this file is the only place that touches a provider instance.
 */

import { ProviderManager }    from './providerManager';
import { openrouterProvider } from './openrouterProvider';
import { ROUTING }            from '../config/routing';

export const providerManager = new ProviderManager(ROUTING).register(openrouterProvider);

export { ProviderManager } from './providerManager';
export type { ResolvedModel, DispatchResult, RoutingConfig, DomainRoute } from './providerManager';
export type { IProvider, GenerateOptions, GenerateResult, CostEstimate } from './baseProvider';
export * from './types';
