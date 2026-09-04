import { defineConfig } from 'drizzle-kit';

/**
 * Migrations are GENERATED here and applied to three separate databases:
 *
 *   ./local.db          `npm run db:migrate`         (drizzle-kit, dev)
 *   emulated D1         `npm run db:migrate:d1`      (wrangler, preview:worker)
 *   remote D1           `npm run db:migrate:remote`  (wrangler, production)
 *
 * Each database keeps exactly one ledger table, so there is no double-apply
 * hazard — but do NOT run `drizzle-kit push`: it needs a Cloudflare API token
 * just to iterate, writes no reviewable artifact, and on SQLite implements
 * column changes as a table recreate plus data copy.
 *
 * `generate` only reads `schema`/`out`/`dialect`, so it works with no
 * credentials at all.
 */
export default defineConfig({
	schema: './src/lib/server/db/schema/*.ts',
	out: './drizzle',
	dialect: 'sqlite',
	dbCredentials: {
		url: process.env.DATABASE_URL ?? 'file:./local.db'
	},
	verbose: true,
	strict: true
});
