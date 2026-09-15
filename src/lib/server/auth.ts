import { getRequestEvent } from '$app/server';
import { passkey } from '@better-auth/passkey';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
// `better-auth/minimal` rather than `better-auth`: the full entry's `init`
// pulls in getMigrations and the Kysely adapter, which we never use and which
// would otherwise be bundled into the worker. The core is identical.
import { betterAuth } from 'better-auth/minimal';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { schema, type Db } from './db';
import { AUTH_SECRET_LENGTH } from '../encryption';

/**
 * The type `@better-auth/passkey` accepts for WebAuthn extensions, derived from
 * the plugin rather than hard-coded, so it stays correct across upgrades.
 */
type PasskeyExtensions = NonNullable<
	NonNullable<NonNullable<Parameters<typeof passkey>[0]>['registration']>['extensions']
>;

/**
 * Ask the authenticator to associate a PRF key with a new passkey.
 *
 * Cast because `@simplewebauthn/server` — whose types the plugin uses — ships
 * its own hand-rolled `AuthenticationExtensionsClientInputs` listing only four
 * extensions, and PRF is not among them. TypeScript's own `lib.dom.d.ts` has
 * had `prf` for a while, and better-auth passes this value through untouched
 * into `generateRegistrationOptions` and on into the options JSON the browser
 * hands to `navigator.credentials.create()` — so the shape that matters at
 * runtime is the DOM one.
 *
 * A narrow cast at one boundary, deliberately, rather than a module
 * augmentation of `@simplewebauthn/server/esm/types/dom`: that path is not in
 * the package's `exports`, so an augmentation would be dropped silently on
 * upgrade, and a silently-dropped PRF request is the worst possible failure
 * here — passkeys would register without a PRF key and could never be used to
 * unlock, which is only discoverable on a new device with no password to hand.
 * If the library ever adds `prf`, this cast becomes a no-op and still compiles.
 */
const PRF_REGISTRATION_EXTENSIONS = { prf: {} } as PasskeyExtensions;

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
		appName: 'Bound Up',
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
		user: {
			additionalFields: {
				timezone: {
					type: 'string',
					defaultValue: 'UTC',
					required: true,
					returned: true
				}
			}
		},
		emailAndPassword: {
			enabled: true,
			autoSignIn: true,
			requireEmailVerification: false,
			// NOT a password policy. The browser posts a 43-character base64url
			// HKDF output in the `password` field and the real password never
			// leaves the device (see src/lib/crypto/kdf.ts and
			// docs/encryption.md), so these are an exact-shape assertion at the
			// auth layer, behind the Zod check that already enforces it.
			//
			// Pinned rather than left at the 8/128 defaults — 43 sits inside those
			// — so that a client bug producing a short secret is a loud 400 instead
			// of a silently accepted weak credential. Safe to pin because
			// /sign-in/email does not length-check at all; only sign-up,
			// change-password and set-password do.
			//
			// The real strength policy is client-side and structurally
			// unenforceable here. That is a consequence of the design, not an
			// oversight; rate limiting is the compensating server-side control.
			minPasswordLength: AUTH_SECRET_LENGTH,
			maxPasswordLength: AUTH_SECRET_LENGTH
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
			passkey({
				rpID: config.rpID,
				rpName: 'Bound Up',
				/**
				 * PRF, so a passkey can later unlock the message identity with the
				 * same touch that signs the user in.
				 *
				 * This MUST be requested at credential *creation* — a passkey
				 * registered without it can never be used for PRF and cannot be
				 * upgraded — so it is requested for every registration, whether or
				 * not the user has set up messaging yet.
				 *
				 * The PRF *salt* is deliberately not set here. Extensions
				 * configured server-side are JSON-serialised, and a salt has to
				 * reach `navigator.credentials.get()` as real bytes; SimpleWebAuthn
				 * spreads `extensions` through untouched and converts only
				 * `challenge` and `allowCredentials`. So the salt is passed
				 * per-call from the browser, which is also what keeps the derived
				 * secret out of this process entirely — the passkey client strips
				 * `clientExtensionResults` before posting the assertion.
				 */
				registration: { extensions: PRF_REGISTRATION_EXTENSIONS }
			}),
			// Must be last — Better Auth warns if the cookie plugin is not.
			sveltekitCookies(getRequestEvent)
		]
	});
}

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth['$Infer']['Session']['session'];
export type User = Auth['$Infer']['Session']['user'];
