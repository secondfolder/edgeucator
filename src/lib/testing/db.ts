import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { schema, type Db } from '../server/db';

/**
 * A throwaway database for a single test.
 *
 * libsql, not better-sqlite3, for the same reason dev uses it (see
 * `src/lib/server/db/dev.ts`): its async signatures and `batch()` match
 * `DrizzleD1Database`, so a test cannot pass against a capability D1 does not
 * have. The result is cast to `Db` for exactly that reason too — application
 * code under test is typed against production.
 *
 * The schema comes from the committed migrations rather than from
 * `drizzle-kit push`, so a test failing on a missing column means the migration
 * is genuinely missing, not that the harness drifted from it.
 */

type JournalEntry = { idx: number; tag: string };

const migrationsDir = path.resolve(process.cwd(), 'drizzle');

let cachedMigrationSql: string[] | undefined;

async function migrationStatements(): Promise<string[]> {
	if (cachedMigrationSql) return cachedMigrationSql;

	const journal = JSON.parse(
		await readFile(path.join(migrationsDir, 'meta', '_journal.json'), 'utf8')
	) as { entries: JournalEntry[] };

	const files = [...journal.entries].sort((a, b) => a.idx - b.idx);
	cachedMigrationSql = await Promise.all(
		files.map((entry) => readFile(path.join(migrationsDir, `${entry.tag}.sql`), 'utf8'))
	);
	return cachedMigrationSql;
}

export type TestDb = {
	db: Db;
	/** Closes the underlying connection. Call from `afterEach`. */
	close: () => void;
};

export async function createTestDb(): Promise<TestDb> {
	const client = createClient({ url: ':memory:' });
	// D1 enforces foreign keys; a test suite that did not would happily accept
	// an invitee_id pointing at nothing.
	await client.execute('PRAGMA foreign_keys = ON');

	for (const sql of await migrationStatements()) {
		// `--> statement-breakpoint` is a plain SQL line comment, so the file can
		// go through executeMultiple verbatim rather than being split by hand.
		await client.executeMultiple(sql);
	}

	return {
		db: drizzle(client, { schema }) as unknown as Db,
		close: () => client.close()
	};
}
