/**
 * Consumed ONLY by `npm run auth:schema` (the `auth` CLI). Never imported by
 * application code, and never part of the worker bundle.
 *
 * The CLI aliases `$app/*`, `$env/*` and `cloudflare:workers` to inert stubs
 * before loading this with jiti, so importing the real factory here is safe
 * despite its `$app/server` import.
 *
 * The database has to be a real Drizzle instance — `drizzleAdapter` reads
 * `db._` at construction, so a null/stub object throws. An in-memory libsql
 * database is never queried: with `--adapter drizzle --dialect sqlite` the CLI
 * builds a mock adapter and only reads `auth.options`.
 */
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { createAuth } from './src/lib/server/auth';
import { schema, type Db } from './src/lib/server/db';

const throwawayDb = drizzle(createClient({ url: ':memory:' }), { schema });

export const auth = createAuth(throwawayDb as unknown as Db, {
	// >= 32 chars purely to avoid a length warning from the CLI.
	secret: 'cli-only-placeholder-secret-0123456789abcdef',
	origin: 'http://localhost:5173',
	rpID: 'localhost',
	host: 'localhost:5173'
});
