/**
 * resetStats.ts
 * Run with: npm run reset:stats
 *
 * Empties performance_stats and request_logs so the strategy engine starts
 * from nothing. Useful before a benchmark after changing weights or tiers.
 * User accounts, keys and history are untouched.
 */

import 'dotenv/config';
import { getDb, schema } from '../db';

async function main(): Promise<void> {
  const db = getDb();
  await db.delete(schema.performanceStats);
  process.stdout.write('Cleared performance_stats\n');
  await db.delete(schema.requestLogs);
  process.stdout.write('Cleared request_logs\n');
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    process.stderr.write(`Reset failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
