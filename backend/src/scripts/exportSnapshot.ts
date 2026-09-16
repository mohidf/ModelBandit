#!/usr/bin/env ts-node
/**
 * exportSnapshot.ts
 *
 * Copies the live performance_stats table into demo/src/snapshot.json so the
 * GitHub Pages demo ranks models with real numbers. Run it whenever the demo
 * should catch up with what the router has learned:
 *
 *   cd backend && npm run export:snapshot
 *
 * Needs DATABASE_URL in backend/.env.
 */

import 'dotenv/config';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { performanceStore } from '../services/performanceStore';

const OUT = resolve(__dirname, '../../../demo/src/snapshot.json');

async function main(): Promise<void> {
  const rows = await performanceStore.getAllStats();
  rows.sort((a, b) => a.taskType.localeCompare(b.taskType) || b.totalRequests - a.totalRequests);

  const rounded = rows.map(r => ({
    ...r,
    averageLatencyMs:  Math.round(r.averageLatencyMs),
    averageConfidence: Number(r.averageConfidence.toFixed(3)),
    escalationRate:    Number(r.escalationRate.toFixed(3)),
    averageCostUsd:    Number(r.averageCostUsd.toFixed(6)),
  }));

  writeFileSync(OUT, JSON.stringify(rounded, null, 2) + '\n');
  process.stdout.write(`Wrote ${rounded.length} rows to ${OUT}\n`);
}

main().catch(err => {
  process.stderr.write(`Export failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
