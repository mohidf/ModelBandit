import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

// `npm run db:generate` turns src/db/schema.ts into SQL under drizzle/.
// `npm run db:migrate` applies whatever is there to DATABASE_URL.
export default defineConfig({
  dialect: 'postgresql',
  schema:  './src/db/schema.ts',
  out:     './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  strict:  true,
  verbose: true,
});
