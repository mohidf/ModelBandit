/**
 * historyStore.ts — a user's last 20 prompts and their routing results.
 */

import { desc, eq, inArray } from 'drizzle-orm';
import { getDb, schema } from '../db';

export const HISTORY_LIMIT = 20;

export interface HistoryRow {
  id:        string;
  prompt:    string;
  result:    unknown;
  createdAt: Date;
}

const columns = {
  id:        schema.userHistory.id,
  prompt:    schema.userHistory.prompt,
  result:    schema.userHistory.result,
  createdAt: schema.userHistory.createdAt,
};

export async function listHistory(userId: string): Promise<HistoryRow[]> {
  return getDb()
    .select(columns)
    .from(schema.userHistory)
    .where(eq(schema.userHistory.userId, userId))
    .orderBy(desc(schema.userHistory.createdAt))
    .limit(HISTORY_LIMIT);
}

/** Insert an entry and drop anything beyond the newest HISTORY_LIMIT rows. */
export async function addHistory(userId: string, prompt: string, result: unknown): Promise<HistoryRow> {
  const db = getDb();

  const [entry] = await db
    .insert(schema.userHistory)
    .values({ userId, prompt, result })
    .returning(columns);

  const stale = await db
    .select({ id: schema.userHistory.id })
    .from(schema.userHistory)
    .where(eq(schema.userHistory.userId, userId))
    .orderBy(desc(schema.userHistory.createdAt))
    .offset(HISTORY_LIMIT);

  if (stale.length > 0) {
    await db.delete(schema.userHistory).where(inArray(schema.userHistory.id, stale.map(r => r.id)));
  }

  return entry;
}

export async function clearHistory(userId: string): Promise<void> {
  await getDb().delete(schema.userHistory).where(eq(schema.userHistory.userId, userId));
}
