import { createClient, type Client } from '@libsql/client';
import { afterEach, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

let client: Client | null = null;

afterEach(() => {
	client?.close();
	client = null;
});

test('timezone migration backfills UTC and leaves the column required', async () => {
	client = createClient({ url: ':memory:' });
	await client.executeMultiple(`
		CREATE TABLE user (
			id text PRIMARY KEY NOT NULL,
			name text NOT NULL,
			email text NOT NULL,
			email_verified integer DEFAULT 0 NOT NULL,
			image text,
			created_at integer NOT NULL,
			updated_at integer NOT NULL
		);
	`);

	await client.execute({
		sql: `insert into user (id, name, email, email_verified, image, created_at, updated_at)
		      values (?, ?, ?, ?, ?, ?, ?)`,
		args: ['u1', 'Ada', 'ada@example.test', 0, null, Date.now(), Date.now()]
	});

	const sql = await readFile(
		path.resolve(process.cwd(), 'drizzle/0007_tranquil_krista_starr.sql'),
		'utf8'
	);
	await client.executeMultiple(sql);

	const rows = await client.execute('select timezone from user where id = ?', ['u1']);
	expect(rows.rows[0]?.timezone).toBe('UTC');

	const info = await client.execute('pragma table_info(`user`)');
	const timezone = info.rows.find((row) => row.name === 'timezone');
	expect(Number(timezone?.notnull)).toBe(1);
	expect(String(timezone?.dflt_value)).toBe("'UTC'");
});
