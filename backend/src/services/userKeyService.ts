/**
 * userKeyService.ts — everything that reads or writes user_api_keys.
 *
 * Keys are scoped by user ID on every query. Only getUserApiKeys() returns
 * the actual key values, and only to the router, never to a client.
 */

import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '../db';

/** Map of provider name → API key for a single user. */
export type UserApiKeyMap = Record<string, string>;

export interface StoredKeyInfo {
  provider:  string;
  updatedAt: Date;
}

/**
 * Fetch all API keys stored for the given user.
 * Returns an empty map on any error so a key lookup can never block a request.
 */
export async function getUserApiKeys(userId: string): Promise<UserApiKeyMap> {
  try {
    const rows = await getDb()
      .select({ provider: schema.userApiKeys.provider, apiKey: schema.userApiKeys.apiKey })
      .from(schema.userApiKeys)
      .where(eq(schema.userApiKeys.userId, userId));
    return Object.fromEntries(rows.map(r => [r.provider, r.apiKey]));
  } catch {
    return {};
  }
}

/** Which providers the user has a key for. Never includes the key itself. */
export async function listKeyProviders(userId: string): Promise<StoredKeyInfo[]> {
  return getDb()
    .select({ provider: schema.userApiKeys.provider, updatedAt: schema.userApiKeys.updatedAt })
    .from(schema.userApiKeys)
    .where(eq(schema.userApiKeys.userId, userId));
}

/** Insert or replace the user's key for one provider. */
export async function upsertKey(userId: string, provider: string, apiKey: string): Promise<void> {
  await getDb()
    .insert(schema.userApiKeys)
    .values({ userId, provider, apiKey })
    .onConflictDoUpdate({
      target: [schema.userApiKeys.userId, schema.userApiKeys.provider],
      set:    { apiKey, updatedAt: new Date() },
    });
}

export async function deleteKey(userId: string, provider: string): Promise<void> {
  await getDb()
    .delete(schema.userApiKeys)
    .where(and(eq(schema.userApiKeys.userId, userId), eq(schema.userApiKeys.provider, provider)));
}
