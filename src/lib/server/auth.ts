import { getRequestEvent } from '$app/server';
import { passkey } from '@better-auth/passkey';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
// `better-auth/minimal` rather than `better-auth`: the full entry's `init`
// pulls in getMigrations and the Kysely adapter, which we never use and which
// would otherwise be bundled into the worker. The core is identical.
import { betterAuth } from 'better-auth/minimal';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { schema, type Db } from './db';

export interface AuthRequestConfig {
	/** `platform.env.BETTER_AUTH_SECRET` in production, `.env` in dev. */
	secret: string;
	/**
	 * MUST be `event.url.origin` verbatim. `svelteKitHandler`'s `isAuthPath`
	 * bails out when `options.baseURL.origin !== request.url.origin`, which
	 * would silently 404 every `/api/auth/*` endpoint.
	 */
	origin: string;
	/** `event.url.hostname` — the WebAuthn rpID, which never includes a port. */
	rpID: string;
	/** `event.url.host` — used to also trust the https form of this host. */
	host: string;
}

/**
 * Builds a Better Auth instance for one request.
 *
 * Per-request rather than module-level because the D1 binding only exists
 * inside a request, and because deriving `baseURL`/`rpID` from the actual
 * request URL makes localhost, the dev tunnel and production all correct with
 * no per-environment configuration.
 */
export function createAuth(db: Db, config: AuthRequestConfig) {
	return betterAuth({
		appName: 'Edgeucator',
		// Passed explicitly: Better Auth's own env lookup reads
		// `globalThis.process.env`, and its fallback is a hard-coded default
		// secret that only throws when NODE_ENV === 'production' — which
		// Workers does not set.
		secret: config.secret,
		baseURL: config.origin,
		// In dev the app may be reached over an https tunnel while `vite dev`
		// builds `event.url` as http://<host> (kit hard-codes the scheme), so the
		// browser's Origin header is https while baseURL is http. `validateOrigin`
		// runs on every cookie-bearing POST to /api/auth/* and would reject it.
		// Trusting both forms of the same host fixes that without changing
		// baseURL, which `isAuthPath` compares against the request origin.
		trustedOrigins: [config.origin, `https://${config.host}`],
		database: drizzleAdapter(db, { provider: 'sqlite', schema }),
		emailAndPassword: {
			enabled: true,
			autoSignIn: true,
			requireEmailVerification: false,
			minPasswordLength: 8
		},
		// NOT enabled by default once a database is configured, so opt in
		// explicitly: this turns the per-request session lookup into a signed
		// cookie read instead of two D1 queries. Cost: revocation lags by up to
		// `maxAge` seconds.
		session: { cookieCache: { enabled: true, maxAge: 60 } },
		telemetry: { enabled: false },
		plugins: [
			// `origin` is deliberately left unset so the plugin uses the real
			// browser Origin header as `expectedOrigin` — which is what the
			// authenticator actually signed. Pinning it would break passkeys
			// behind the https dev tunnel. `expectedRPID` is pinned here, which
			// is the check that matters.
			passkey({ rpID: config.rpID, rpName: 'Edgeucator' }),
			// Must be last — Better Auth warns if the cookie plugin is not.
			sveltekitCookies(getRequestEvent)
		]
	});
}

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth['$Infer']['Session']['session'];
export type User = Auth['$Infer']['Session']['user'];
