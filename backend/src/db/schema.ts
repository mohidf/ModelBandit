/**
 * schema.ts — every table, in Drizzle's schema DSL.
 *
 * The first four tables (user, session, account, verification) are what
 * Better Auth expects; their column names must match its field names exactly.
 * The rest are the router's own. `drizzle-kit generate` turns this file into
 * SQL migrations under backend/drizzle/.
 */

import {
  pgTable, text, boolean, timestamp, integer, doublePrecision, jsonb, index, primaryKey, uniqueIndex,
} from 'drizzle-orm/pg-core';

// ── Better Auth ────────────────────────────────────────────────────────────────

export const user = pgTable('user', {
  id:            text('id').primaryKey(),
  name:          text('name').notNull(),
  email:         text('email').notNull().unique(),
  emailVerified: boolean('emailVerified').notNull().default(false),
  image:         text('image'),
  createdAt:     timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable('session', {
  id:        text('id').primaryKey(),
  expiresAt: timestamp('expiresAt', { withTimezone: true }).notNull(),
  token:     text('token').notNull().unique(),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  userId:    text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
}, t => [index('session_userId_idx').on(t.userId)]);

export const account = pgTable('account', {
  id:                    text('id').primaryKey(),
  accountId:             text('accountId').notNull(),
  providerId:            text('providerId').notNull(),
  userId:                text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken:           text('accessToken'),
  refreshToken:          text('refreshToken'),
  idToken:               text('idToken'),
  accessTokenExpiresAt:  timestamp('accessTokenExpiresAt', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt', { withTimezone: true }),
  scope:                 text('scope'),
  password:              text('password'),
  createdAt:             timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:             timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('account_userId_idx').on(t.userId)]);

export const verification = pgTable('verification', {
  id:         text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value:      text('value').notNull(),
  expiresAt:  timestamp('expiresAt', { withTimezone: true }).notNull(),
  createdAt:  timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('verification_identifier_idx').on(t.identifier)]);

// ── Router ────────────────────────────────────────────────────────────────────

/** One row per (model, task type): running averages the strategy engine scores. */
export const performanceStats = pgTable('performance_stats', {
  modelId:        text('model_id').notNull(),
  provider:       text('provider').notNull(),
  tier:           text('tier').notNull(),
  taskType:       text('task_type').notNull(),
  totalRequests:  integer('total_requests').notNull().default(0),
  avgLatencyMs:   doublePrecision('avg_latency_ms').notNull().default(0),
  avgConfidence:  doublePrecision('avg_confidence').notNull().default(0),
  escalationRate: doublePrecision('escalation_rate').notNull().default(0),
  avgCostUsd:     doublePrecision('avg_cost_usd').notNull().default(0),
  updatedAt:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  primaryKey({ columns: [t.modelId, t.taskType] }),
  index('performance_stats_provider_tier_idx').on(t.provider, t.tier, t.taskType),
]);

/** One row per completed request. Stores a hash of the prompt, never the text. */
export const requestLogs = pgTable('request_logs', {
  id:           integer('id').primaryKey().generatedAlwaysAsIdentity(),
  promptHash:   text('prompt_hash').notNull(),
  promptLength: integer('prompt_length').notNull(),
  modelId:      text('model_id').notNull(),
  provider:     text('provider').notNull(),
  tier:         text('tier').notNull(),
  taskType:     text('task_type').notNull(),
  latencyMs:    doublePrecision('latency_ms').notNull(),
  confidence:   doublePrecision('confidence').notNull(),
  costUsd:      doublePrecision('cost_usd').notNull(),
  escalated:    boolean('escalated').notNull(),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  index('request_logs_created_at_idx').on(t.createdAt),
  index('request_logs_routing_idx').on(t.provider, t.tier, t.taskType),
]);

/** A user's own provider API keys. One per provider. */
export const userApiKeys = pgTable('user_api_keys', {
  id:        text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId:    text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  provider:  text('provider').notNull(),
  apiKey:    text('api_key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex('user_api_keys_user_provider_idx').on(t.userId, t.provider)]);

/** A user's recent prompts and the full routing result for each. */
export const userHistory = pgTable('user_history', {
  id:        text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId:    text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  prompt:    text('prompt').notNull(),
  result:    jsonb('result').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('user_history_user_created_idx').on(t.userId, t.createdAt)]);
