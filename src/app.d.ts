// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces

import type { AnyD1Database } from 'drizzle-orm/d1';
import type { Auth, Session, User } from '$lib/server/auth';
import type { Db } from '$lib/server/db';
import type { MediaBucket } from '$lib/server/media';
import type { RealtimeNamespace } from '$lib/server/realtime/binding';

declare global {
	var litIssuedWarnings: Set<string> | undefined;

	namespace App {
		// interface Error {}
		interface Locals {
			/** Per-request Drizzle client — D1 in production, libsql in dev. */
			db: Db;
			/** Per-request Better Auth instance. */
			auth: Auth;
			session: Session | null;
			user: User | null;
		}
		// interface PageData {}
		// interface PageState {}
		interface Platform {
			// Only `env` is declared: nothing in this app uses platform.ctx /
			// caches / cf. `AnyD1Database` comes from drizzle rather than
			// @cloudflare/workers-types on purpose — that package exposes its
			// types as ambient globals, and pulling them in would overwrite the
			// DOM's Request/Response/fetch/Cache for the whole project,
			// including the jsdom test project.
			env: {
				DB: AnyD1Database;
				BETTER_AUTH_SECRET: string;
				/**
				 * The R2 bucket holding encrypted attachments.
				 *
				 * Structurally typed in `$lib/server/media` rather than imported
				 * from @cloudflare/workers-types, for the same ambient-globals
				 * reason as `AnyD1Database` above.
				 */
				MEDIA: MediaBucket;
				/**
				 * The Durable Object namespace behind the live message feed.
				 *
				 * Structurally typed in `$lib/server/realtime/binding` rather
				 * than imported from @cloudflare/workers-types, for the same
				 * ambient-globals reason as the two above.
				 */
				REALTIME: RealtimeNamespace;
			};
		}
	}
}

export {};
