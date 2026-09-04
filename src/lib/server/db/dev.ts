import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import type { RequestEvent } from '@sveltejs/kit';
import { createD1Db, schema, type Db } from './index';
import { requireD1 } from './platform';

let devDb: Db | undefined;

/**
 * Returns the request's database client.
 *
 * Production uses D1 over `event.platform.env.DB`. Local dev uses a plain
 * SQLite file through libsql, so `npm run dev` needs no Cloudflare account,
 * no wrangler config and no workerd — and drizzle-kit's migrate/studio work
 * directly against the same file.
 *
 * libsql rather than better-sqlite3 because `LibSQLDatabase` is
 * `BaseSQLiteDatabase<'async', ...>` with a `batch()` signature identical to
 * `DrizzleD1Database`, whereas `BetterSQLite3Database` is `'sync'` with no
 * `batch()` — which would let dev code be written that cannot work on D1.
 *
 * The dev/prod split does leave real divergences to respect:
 *   - `db.transaction()` works here but FAILS on D1 (drizzle's D1 driver emits
 *     raw `begin`/`commit`; D1 is auto-commit and offers `batch()` instead).
 *     Use `batch()`.
 *   - D1 enforces foreign keys by default. libsql happens to as well (verified),
 *     but the PRAGMA below is kept explicit so this does not silently depend on
 *     a libsql default that plain SQLite does not share.
 *   - D1's row/response size limits are not enforced locally.
 * `npm run preview:worker` is the pre-deploy gate that exercises the real path.
 */
export async function createDb(event: RequestEvent): Promise<Db> {
	// `dev` is a build-time constant, so this whole branch — and with it the
	// native @libsql/client dependency — is dead-code-eliminated from the
	// worker bundle.
	if (dev) {
		if (!devDb) {
			const { createClient } = await import('@libsql/client');
			const { drizzle } = await import('drizzle-orm/libsql');
			const client = createClient({ url: env.DATABASE_URL || 'file:./local.db' });
			// Redundant on libsql (it defaults to on) but explicit so that FK
			// behaviour matches D1 regardless of driver defaults.
			await client.execute('PRAGMA foreign_keys = ON');
			devDb = drizzle(client, { schema }) as unknown as Db;
		}
		// A module-level cache is safe ONLY because this branch is dev-only; the
		// production path below stays strictly per-request.
		return devDb;
	}

	return createD1Db(requireD1(event.platform));
}
