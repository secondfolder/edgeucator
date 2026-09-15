/**
 * Turning a password into the two keys this app needs, in the browser.
 *
 * BROWSER ONLY. Nothing under `src/lib/crypto/` may be imported from
 * `src/lib/server/**` or from any `+*.server.ts` — see AGENTS.md. The server's
 * entire involvement in encryption is storing and returning opaque strings.
 *
 * Zero dependencies, WebCrypto only, and deliberately in its own file: the
 * login and signup pages need exactly this and nothing else, so they must not
 * pull in `identity.ts` and, through it, all of age-encryption.
 *
 * The shape is Bitwarden's published design. One expensive derivation from the
 * password, then two cheap one-way derivations from that:
 *
 *     masterKey  = PBKDF2-SHA256(password, "bound-up-mk-v1|" + email, 650k)
 *     authSecret = HKDF(masterKey, "bound-up-auth-v1")   -> sent to the server
 *     wrapKey    = HKDF(masterKey, "bound-up-wrap-v1")   -> never leaves here
 *
 * The server receives only `authSecret` and hashes it again with its own scrypt
 * and its own per-user salt, so a stolen database is not a login verifier. And
 * because HKDF is one-way, the value the server holds cannot be turned back
 * into `masterKey` or `wrapKey`.
 *
 * What this does NOT buy, and docs/encryption.md says so in its first
 * paragraph: the server ships the JavaScript that runs this. A server that
 * wants the password adds a line and gets it. What it does buy is that no
 * plaintext password exists in a request log, an error report, or a captured
 * request — which is real, and is why it is worth doing.
 */

import {
	AUTH_SECRET_INFO,
	AUTH_SECRET_LENGTH,
	MASTER_KEY_VERSIONS,
	PRF_WRAP_KEY_INFO,
	WRAP_KEY_INFO,
	masterKeySalt,
	toBase64Url,
	type MasterKeyParams
} from '../encryption';

/**
 * An intermediate. Carries its params so that a login which succeeded against
 * an older ladder entry knows which one it was, and can offer to upgrade.
 */
export type MasterKey = {
	/** An HKDF key. Non-extractable, so the master key never exists as bytes. */
	readonly key: CryptoKey;
	readonly params: MasterKeyParams;
};

const encoder = new TextEncoder();

/**
 * `crypto.subtle` exists only in secure contexts: https, or http on localhost.
 * The dev tunnel host is plain http, so a page loaded through it has no
 * WebCrypto and every derivation below dies with the cryptic
 * "can't access property 'importKey', crypto.subtle is undefined". The forms
 * check this before they start and show `WEBCRYPTO_UNAVAILABLE` instead.
 */
export function webCryptoAvailable(): boolean {
	return typeof crypto !== 'undefined' && crypto.subtle != null;
}

export const WEBCRYPTO_UNAVAILABLE =
	'This page was loaded over plain http, so the browser has withheld WebCrypto — and the sign-in keys are derived here, in your browser. Open the app on https, or on http://localhost, and try again.';

/**
 * PBKDF2 over the password, then re-imported as an HKDF key.
 *
 * Two steps rather than one `deriveKey` because WebCrypto will not derive
 * *into* an HKDF key — HKDF has no "get key length" operation, so the spec has
 * nothing to tell `deriveKey` how many bytes to produce. `deriveBits` followed
 * by `importKey` is the supported route.
 *
 * The raw bits exist in a local for the duration of that hand-off, which is
 * unavoidable; everything derived from them afterwards is non-extractable.
 */
export async function deriveMasterKey(
	password: string,
	email: string,
	params: MasterKeyParams = MASTER_KEY_VERSIONS[0]
): Promise<MasterKey> {
	if (!webCryptoAvailable()) throw new Error(WEBCRYPTO_UNAVAILABLE);

	const base = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
		'deriveBits'
	]);

	const bits = await crypto.subtle.deriveBits(
		{
			name: 'PBKDF2',
			hash: 'SHA-256',
			salt: encoder.encode(masterKeySalt(email, params)),
			iterations: params.iterations
		},
		base,
		256
	);

	const key = await crypto.subtle.importKey('raw', bits, 'HKDF', false, [
		'deriveBits',
		'deriveKey'
	]);
	return { key, params };
}

/** HKDF-Expand with an empty salt — the master key is already salted. */
function hkdf(info: string): HkdfParams {
	return { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: encoder.encode(info) };
}

/**
 * The value posted to Better Auth in the `password` field.
 *
 * 32 bytes as unpadded base64url, which is exactly `AUTH_SECRET_LENGTH`
 * characters — the same constant the Zod schema checks against, imported rather
 * than repeated so the two cannot drift.
 */
export async function deriveAuthSecret(master: MasterKey): Promise<string> {
	const bits = await crypto.subtle.deriveBits(hkdf(AUTH_SECRET_INFO), master.key, 256);
	const secret = toBase64Url(new Uint8Array(bits));
	// A cheap assertion rather than a comment claiming the length: if a future
	// change to toBase64Url ever padded its output, every login would start
	// failing server-side validation with a message about JavaScript, which is
	// exactly the wrong thing to debug.
	if (secret.length !== AUTH_SECRET_LENGTH) {
		throw new Error(`Auth secret is ${secret.length} characters, expected ${AUTH_SECRET_LENGTH}`);
	}
	return secret;
}

/**
 * The AES-GCM key that opens the stored wrap of the age identity.
 *
 * `deriveKey` straight to AES-GCM with `extractable: false`, so this key never
 * exists as bytes anywhere in JS — there is no API that returns it, only ones
 * that use it.
 */
export async function deriveWrapKey(master: MasterKey): Promise<CryptoKey> {
	return crypto.subtle.deriveKey(
		hkdf(WRAP_KEY_INFO),
		master.key,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
}

/**
 * The same, from a passkey's PRF output instead of a password.
 *
 * A different `info` string, so a PRF wrap key and a password wrap key are
 * unrelated even in the impossible case of the two inputs colliding. The wrap
 * *format* is identical, which is the point: there is exactly one AES-GCM
 * envelope in this codebase, and one set of tests for it.
 *
 * `prfOutput` is 32 bytes from `clientExtensionResults.prf.results.first`. It
 * has never been near the server — Better Auth's passkey client strips
 * `clientExtensionResults` before posting the assertion.
 */
export async function deriveWrapKeyFromPrf(prfOutput: ArrayBuffer): Promise<CryptoKey> {
	if (prfOutput.byteLength < 32) {
		throw new Error(`PRF output is ${prfOutput.byteLength} bytes, expected at least 32`);
	}
	const key = await crypto.subtle.importKey('raw', prfOutput, 'HKDF', false, ['deriveKey']);
	return crypto.subtle.deriveKey(
		hkdf(PRF_WRAP_KEY_INFO),
		key,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
}
