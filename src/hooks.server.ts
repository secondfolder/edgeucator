import { building } from '$app/environment';
import { env as privateEnv } from '$env/dynamic/private';
import { createAuth } from '$lib/server/auth';
import { createDb } from '$lib/server/db/dev';
import type { Handle } from '@sveltejs/kit';
import { getSessionCookie } from 'better-auth/cookies';
import { svelteKitHandler } from 'better-auth/svelte-kit';

export const handle: Handle = async ({ event, resolve }) => {
	// Bail before touching platform.env. During prerendering adapter-cloudflare
	// substitutes a platform whose env getters throw. svelteKitHandler also
	// short-circuits on `building`, but only after we would have dereferenced
	// the binding.
	if (building) return resolve(event);

	const db = await createDb(event);

	// Production reads wrangler secrets from platform.env; dev has no platform
	// at all (svelte.config.js strips the adapter's emulate hook) and reads
	// .env instead. Fail loudly: Better Auth otherwise falls back to a
	// hard-coded default secret, and its own check only throws when
	// NODE_ENV === 'production', which Workers does not set.
	const secret = event.platform?.env?.BETTER_AUTH_SECRET ?? privateEnv.BETTER_AUTH_SECRET;
	if (!secret) {
		throw new Error(
			'BETTER_AUTH_SECRET is not set. In development put it in .env ' +
				'(generate one with `npm run auth:secret`); in production set it with ' +
				'`npx wrangler secret put BETTER_AUTH_SECRET`.'
		);
	}

	const auth = createAuth(db, {
		secret,
		origin: event.url.origin,
		rpID: event.url.hostname,
		host: event.url.host
	});

	event.locals.db = db;
	event.locals.auth = auth;
	event.locals.session = null;
	event.locals.user = null;

	// Cheap gate: skip the session lookup entirely for anonymous traffic. The
	// public surface is now just /, /login and /signup — the guides moved under
	// /home when the app shell landed, so they sit behind the group guard.
	if (getSessionCookie(event.request)) {
		const result = await auth.api.getSession({ headers: event.request.headers });
		if (result) {
			event.locals.session = result.session;
			event.locals.user = result.user;
		}
	}

	// Serves /api/auth/* from auth.handler and otherwise falls through to
	// resolve, so no src/routes/api/auth/[...all]/+server.ts is needed.
	// Note: for auth requests `resolve` is never called.
	return svelteKitHandler({ auth, event, resolve, building });
};
