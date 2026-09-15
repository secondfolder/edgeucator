import type { AnyD1Database } from 'drizzle-orm/d1';

/**
 * Extracts the D1 binding from `event.platform`, failing with an actionable
 * message rather than a `Cannot read properties of undefined`.
 *
 * `event.platform` is populated only when running on Workers (`wrangler dev` or
 * deployed) — `svelte.config.js` strips the adapter's `emulate` hook, so in
 * `vite dev` there is no platform at all and the libsql path in `./dev.ts` is
 * used instead.
 */
export function requireD1(platform: App.Platform | undefined): AnyD1Database {
	if (!platform?.env?.DB) {
		throw new Error(
			'The D1 binding "DB" is unavailable. This code path only runs on Cloudflare ' +
				'Workers. Check that wrangler.jsonc has a d1_databases entry with ' +
				'"binding": "DB" and a real database_id (create one with ' +
				'`npx wrangler d1 create bound-up`), and that migrations have been ' +
				'applied with `npm run db:migrate:d1` (local) or ' +
				'`npm run db:migrate:remote` (production).'
		);
	}
	return platform.env.DB;
}
