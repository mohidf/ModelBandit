/**
 * db/index.ts — the Drizzle client, created once on first use.
 *
 * DATABASE_URL is a normal Postgres connection string. Neon's pooled URL
 * works as-is; so does a local Postgres or Docker container.
 */

import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;

let _db: Db | null = null;

export function getDb(): Db {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('Missing required environment variable: DATABASE_URL');
    const pool = new Pool({ connectionString: url, max: 10 });
    _db = drizzle({ client: pool, schema });
  }
  return _db;
}

export { schema };
