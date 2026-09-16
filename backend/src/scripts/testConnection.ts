/**
 * testConnection.ts
 * Run with: npm run test:db
 * Checks that DATABASE_URL works and the migrations have been applied.
 */

import 'dotenv/config';
import { count, sql } from 'drizzle-orm';
import { getDb, schema } from '../db';

async function main(): Promise<void> {
  const db = getDb();
  process.stdout.write('Connecting…\n');

  const tables = [
    ['user',              schema.user],
    ['performance_stats', schema.performanceStats],
    ['request_logs',      schema.requestLogs],
    ['user_api_keys',     schema.userApiKeys],
    ['user_history',      schema.userHistory],
  ] as const;

  for (const [name, table] of tables) {
    const [{ n }] = await db.select({ n: count() }).from(table);
    process.stdout.write(`ok  ${name.padEnd(18)} ${n} rows\n`);
  }

  const fn = await db.execute(sql`SELECT 1 FROM pg_proc WHERE proname = 'record_performance'`);
  if (fn.rows.length === 0) throw new Error('record_performance() is missing. Run npm run db:migrate.');
  process.stdout.write('ok  record_performance()\n');
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.stderr.write('If tables are missing, run: npm run db:migrate\n');
    process.exit(1);
  });
