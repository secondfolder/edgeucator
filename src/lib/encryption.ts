/**
 * The encryption domain: types, constants, and the string-and-state logic that
 * has no cryptography in it.
 *
 * Deliberately alias-free (relative imports only) for the same reason as
 * `src/lib/partnership.ts`: the Drizzle schema imports `KeyWrapType` and
 * `KeyWrapParams` from here, and drizzle-kit loads the schema outside Vite,
 * where `$lib` does not resolve.
 *
 * Nothing in here calls `crypto.subtle`, touches IndexedDB, or imports
 * age-encryption. That split is why the login page can derive a key without
 * pulling in the whole message-encryption stack — see `src/lib/crypto/`, which
 * is the browser-only half and must never be imported from server code.
 */

import { base32crockford } from '@scure/base';

// ── the auth secret ──────────────────────────────────────────────────────────

/**
 * Length of the base64url auth secret the browser posts in place of a password.
 *
 * 32 bytes of HKDF output is 43 unpadded base64url characters. Both the Zod
 * schema and the KDF import this constant so the two cannot drift — a mismatch
 * would reject every login with a validation error that named the wrong cause.
 */
export const AUTH_SECRET_LENGTH = 43;

/** What a valid auth secret looks like. Used by the Zod field and by tests. */
export const AUTH_SECRET_PATTERN = new RegExp(`^[A-Za-z0-9_-]{${AUTH_SECRET_LENGTH}}$`);

// ── the master key ladder ────────────────────────────────────────────────────

export type MasterKeyParams = {
	version: number;
	kdf: 'PBKDF2-SHA256';
	iterations: number;
};

/**
 * PBKDF2-SHA256 at 650,000 iterations — OWASP's current figure for SHA-256, and
 * roughly Bitwarden's default.
 *
 * Native via WebCrypto rather than a memory-hard KDF on purpose: pure-JS
 * Argon2id at parameters worth having costs 1-3 seconds on a phone and blocks
 * the main thread, and this runs on every single login. See MASTER_KEY_VERSIONS
 * for how a move to Argon2id happens later without a migration.
 */
export const MASTER_KEY_V1: MasterKeyParams = {
	version: 1,
	kdf: 'PBKDF2-SHA256',
	iterations: 650_000
};

/**
 * Every master-key parameter set this client understands, NEWEST FIRST.
 *
 * Login derives against `MASTER_KEY_VERSIONS[0]` and, only after the server
 * rejects that, retries the older ones. It deliberately does NOT ask the server
 * which version an email uses: that lookup would answer "does this account
 * exist?" for anyone who asked, which is the hole in Bitwarden's
 * `/accounts/prelogin`. Trying newest-then-older costs a wrong password one
 * extra derivation and tells an attacker nothing, because a nonexistent account
 * fails every attempt identically.
 *
 * This ladder exists from day one precisely so it never has to be retrofitted —
 * adding it later would need the oracle it exists to avoid.
 */
export const MASTER_KEY_VERSIONS: readonly MasterKeyParams[] = [MASTER_KEY_V1];

/** HKDF `info` strings. Distinct so one master key yields two unrelated keys. */
export const AUTH_SECRET_INFO = 'bound-up-auth-v1';
export const WRAP_KEY_INFO = 'bound-up-wrap-v1';
export const PRF_WRAP_KEY_INFO = 'bound-up-wrap-prf-v1';

/**
 * The PBKDF2 salt.
 *
 * The email, because login has to derive the key *before* it can ask the server
 * for anything, so the salt must be something the user already typed. It is
 * low-entropy and public, which is why the version prefix is there: it is the
 * only thing separating this app's derivation from any other service that salts
 * with an email. It does not make a weak password safe — see docs/encryption.md.
 */
export function masterKeySalt(email: string, params: MasterKeyParams): string {
	return `bound-up-mk-v${params.version}|${normaliseEmail(email)}`;
}

/**
 * The one definition of email normalisation, and it must never change.
 *
 * Every derivation of a master key runs the address through here. If two paths
 * disagree by a single byte — a stray space, a different case — the wrap will
 * not open and the user is locked out of their own message history with no way
 * to tell why. Better Auth lowercases the stored address, but the unlock prompt
 * reads `page.data.user.email` and must still go through this rather than
 * assuming it arrives normalised.
 *
 * Deliberately NOT doing anything cleverer: no Gmail dot-stripping, no
 * plus-address trimming. Both would be reasonable product behaviour and both
 * would silently change the derived key for existing accounts.
 */
export function normaliseEmail(email: string): string {
	return email.trim().toLowerCase();
}

// ── key wraps ────────────────────────────────────────────────────────────────

/**
 * How a stored wrap can be opened.
 *
 * - `password` — AES-GCM under a key derived from the account password.
 * - `webauthn-prf` — AES-GCM under a key derived from a passkey's PRF output.
 *
 * The server stores the `type`, an opaque `params` blob it never reads, and the
 * ciphertext. That is the whole extension point: another unlock method is a new
 * member of this union plus client code, not a migration.
 */
export type KeyWrapType = 'password' | 'webauthn-prf';

export type KeyWrapParams =
	| {
			type: 'password';
			kdf: 'PBKDF2-SHA256';
			/** Which MASTER_KEY_VERSIONS entry produced this wrap. */
			version: number;
			iterations: number;
	  }
	| {
			type: 'webauthn-prf';
			version: 1;
			/** base64url credential id, so unlock knows which passkey to ask for. */
			credentialId: string;
			/** base64url PRF salt. Stored because it is an input, not a secret. */
			salt: string;
	  };

/** How long a serialised `KeyWrapParams` may be. Generous; it is a few fields. */
export const MAX_WRAP_PARAMS_LENGTH = 512;

/**
 * Parses the `params` a client submitted alongside a wrap.
 *
 * The server never uses these values — it stores them and hands them back — so
 * this checks only that the blob is a bounded JSON object naming a wrap type
 * this version understands. Validating the contents any harder would be the
 * server pretending to an authority it does not have, and would mean a new
 * unlock method could not ship without a server change.
 *
 * Shared by the Zod field and by the action, so "valid" means one thing.
 */
export function parseKeyWrapParams(raw: string): KeyWrapParams | null {
	if (raw.length === 0 || raw.length > MAX_WRAP_PARAMS_LENGTH) return null;

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;

	const type = (parsed as { type?: unknown }).type;
	if (type !== 'password' && type !== 'webauthn-prf') return null;

	return parsed as KeyWrapParams;
}

/**
 * The AES-GCM additional-authenticated-data for a wrap.
 *
 * Binds the ciphertext to the public key it belongs to, so a wrap row moved
 * between accounts fails its tag check rather than decrypting to someone else's
 * identity. The user id is deliberately NOT in here: it does not exist yet when
 * signup builds the first wrap, and including it would cost an extra round trip
 * to rewrite the blob once the id was known. What that gives up is covered in
 * docs/encryption.md — swapping both the key row and the wrap row hands each
 * user material neither can open, which is a failed unlock, not a compromise.
 */
export function wrapAad(recipient: string): string {
	return `${WRAP_KEY_INFO}|${recipient}`;
}

// ── base64url ────────────────────────────────────────────────────────────────

/**
 * Bytes to unpadded base64url.
 *
 * base64url rather than base64 so a wrap can sit in a URL or a JSON body
 * without escaping, and unpadded so the length check in the Zod schema is an
 * exact character count. Built on `btoa`, which is a global in browsers, in
 * workerd and in Node >= 16, so this needs no dependency.
 */
export function toBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * The inverse. Throws on anything that is not base64url.
 *
 * Returns `Uint8Array<ArrayBuffer>` rather than a bare `Uint8Array`: since
 * TypeScript 5.9 the latter is generic over `ArrayBufferLike`, which includes
 * `SharedArrayBuffer` and is therefore not assignable to the `BufferSource`
 * that `crypto.subtle` takes. The buffer really is a plain `ArrayBuffer` — it
 * is allocated three lines down — so this is a narrowing, not an assertion.
 * age-encryption carries the same workaround in its `domBuffer` helper.
 */
export function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
	if (!/^[A-Za-z0-9_-]*$/.test(value)) {
		throw new Error('Not base64url');
	}
	const padded = value.replace(/-/g, '+').replace(/_/g, '/');
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

// ── the safety number ────────────────────────────────────────────────────────

/**
 * The bytes the safety number is computed over.
 *
 * The two recipients, sorted. Sorted so both people derive the same number
 * without either needing to know who is "first": the inviter/invitee roles are
 * stable, but a number that depended on them would not match when one partner
 * read theirs out to the other.
 *
 * The version prefix is domain separation — if this format ever changes, an old
 * pinned number cannot be mistaken for a new one.
 */
export function safetyNumberSource(a: string, b: string): string {
	const [first, second] = [a, b].sort();
	return `bound-up-safety-v1\n${first}\n${second}`;
}

/** How many bytes of the digest the safety number shows. 10 bytes = 80 bits. */
export const SAFETY_NUMBER_BYTES = 10;

/**
 * 80 bits of a digest as Crockford base32, in groups of four.
 *
 * Crockford rather than hex or plain base32: it has no I, L, O or U, so there
 * is no one/ell or zero/oh ambiguity when someone reads it down a phone line,
 * and it decodes case-insensitively. 80 bits is 16 characters — long enough
 * that forging a match is a 2^80 search, short enough to read aloud without
 * losing your place, which is the actual constraint on this number.
 */
export function formatSafetyNumber(digest: Uint8Array): string {
	if (digest.length < SAFETY_NUMBER_BYTES) {
		throw new Error(`Digest must be at least ${SAFETY_NUMBER_BYTES} bytes`);
	}
	const encoded = base32crockford.encode(digest.subarray(0, SAFETY_NUMBER_BYTES));
	return encoded.replace(/(.{4})(?=.)/g, '$1-');
}

// ── trust on first use ───────────────────────────────────────────────────────

/** A partner's public key as this device first saw it. Stored locally only. */
export type PinRecord = {
	partnershipId: string;
	recipient: string;
	pinnedAt: number;
	/** Set only when the user says they compared the number out of band. */
	verifiedAt: number | null;
};

export type PinState =
	/** They have not set up encrypted messaging yet. Nothing to pin. */
	| { kind: 'missing' }
	/** First sight on this device. Sending is allowed — that is what TOFU means. */
	| { kind: 'new' }
	/** Matches what we pinned, but never compared out of band. */
	| { kind: 'pinned'; pinnedAt: number }
	/** Matches, and the user says they checked it with their partner. */
	| { kind: 'verified'; verifiedAt: number }
	/** MISMATCH. Sending is blocked until the user accepts the new key. */
	| { kind: 'changed'; pinned: PinRecord; served: string };

/**
 * Compares what the server served against what this device pinned.
 *
 * Note that `verified` is never inherited by a new key: a partner who was
 * verified and whose recipient then changes comes back as `changed`, not as
 * still-verified. Carrying verification across a key change would defeat the
 * entire point of having pinned it.
 */
export function pinStateFor(pinned: PinRecord | undefined, served: string | null): PinState {
	if (!served) return { kind: 'missing' };
	if (!pinned) return { kind: 'new' };
	if (pinned.recipient !== served) return { kind: 'changed', pinned, served };
	if (pinned.verifiedAt !== null) return { kind: 'verified', verifiedAt: pinned.verifiedAt };
	return { kind: 'pinned', pinnedAt: pinned.pinnedAt };
}

/** True when this state must stop the user sending until they act on it. */
export function pinBlocksSending(state: PinState): boolean {
	return state.kind === 'missing' || state.kind === 'changed';
}
