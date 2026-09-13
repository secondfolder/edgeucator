/**
 * The unlocked identity for this browser session.
 *
 * BROWSER ONLY — see the note at the top of `kdf.ts`.
 *
 * One module-level piece of state, because there is one identity per signed-in
 * user and every screen that touches a message needs the same one. Components
 * read it through `currentKeyring()`; nothing else may reassign it.
 */

import { normaliseEmail, type KeyWrapParams } from '../encryption';
import { deriveMasterKey, deriveWrapKey, type MasterKey } from './kdf';
import { importIdentityKey, webCryptoX25519Available } from './identity';
import { keyStore, type CachedIdentity } from './keystore';
import { clearStash, takeUnlock } from './stash';
import { unwrapIdentity } from './wrap';
import type { KeyWrapView, UnlockBundleView } from '../types';

export type Keyring =
	/** Not looked at yet. The gate has not run. */
	| { status: 'unknown' }
	/** This account has no message keys — a legacy or passkey-first account. */
	| { status: 'absent' }
	/**
	 * Keys exist but this device cannot open them yet.
	 *
	 * `reason` is what the prompt says: a cold start is ordinary and expected
	 * (storage evicted, new device, passkey sign-in), a failed attempt is not.
	 */
	| {
			status: 'locked';
			recipient: string;
			wraps: KeyWrapView[];
			reason: 'cold' | 'wrong-password' | 'no-usable-wrap';
	  }
	/**
	 * Open. `identity` is a non-extractable `CryptoKey` wherever the browser can
	 * do X25519, and the raw string otherwise — see `webCryptoX25519Available`.
	 */
	| {
			status: 'unlocked';
			recipient: string;
			identity: CryptoKey | string;
			/** False when the identity is held in memory only, so unlock repeats. */
			durable: boolean;
	  };

let keyring = $state<Keyring>({ status: 'unknown' });
let initialisingForUserId: string | null = null;
let initialisingPromise: Promise<Keyring> | null = null;

/** The current keyring. Reactive: reading this in a template tracks it. */
export function currentKeyring(): Keyring {
	return keyring;
}

/** The identity, or null when locked. For the encrypt/decrypt helpers. */
export function unlockedIdentity(): { recipient: string; identity: CryptoKey | string } | null {
	return keyring.status === 'unlocked'
		? { recipient: keyring.recipient, identity: keyring.identity }
		: null;
}

async function cache(userId: string, recipient: string, identity: string): Promise<Keyring> {
	const store = await keyStore();
	// A non-extractable CryptoKey where possible, because that is the form no
	// API can hand back as bytes. Where the browser cannot do X25519, the string
	// is kept in memory and never written to storage.
	const usable = store.durable && (await webCryptoX25519Available());
	const value: CachedIdentity = {
		userId,
		recipient,
		key: usable ? await importIdentityKey(identity) : identity
	};
	if (usable) await store.putIdentity(value);
	return {
		status: 'unlocked',
		recipient,
		identity: value.key,
		durable: usable
	};
}

/**
 * Tries every wrap of the right kind against a wrap key.
 *
 * Returns the identity and which wrap opened it, so the caller can note that
 * the wrap was used. More than one password wrap can legitimately exist — a
 * password change inserts the new one before changing the credential — so this
 * is a loop rather than a lookup.
 */
async function tryWraps(
	wraps: KeyWrapView[],
	recipient: string,
	wrapKeyFor: (params: KeyWrapParams) => Promise<CryptoKey | null>
): Promise<{ identity: string; wrapId: string } | null> {
	for (const wrap of wraps) {
		const wrapKey = await wrapKeyFor(wrap.params);
		if (!wrapKey) continue;
		const identity = await unwrapIdentity({ wrapKey, blob: wrap.blob, recipient });
		if (identity) return { identity, wrapId: wrap.id };
	}
	return null;
}

/**
 * Works out where this device stands, without asking for anything.
 *
 * Called once by `EncryptionGate` when the app shell mounts. Three ways it can
 * end up unlocked without a prompt: the identity is already cached; or the user
 * signed in moments ago and the wrap key is still in the stash; or there are no
 * keys at all, which is `absent` rather than locked.
 */
export async function initialiseKeyring(user: { id: string; email: string }): Promise<Keyring> {
	if (keyring.status !== 'unknown') return keyring;
	if (initialisingForUserId === user.id && initialisingPromise) return initialisingPromise;

	const run = (async (): Promise<Keyring> => {
		const storePromise = keyStore();
		const bundlePromise = fetchBundle();
		const store = await storePromise;

		const cached = await store.getIdentity(user.id);
		if (cached) {
			keyring = {
				status: 'unlocked',
				recipient: cached.recipient,
				identity: cached.key,
				durable: store.durable
			};
			return keyring;
		}

		const bundle = await bundlePromise;
		if (!bundle.recipient) {
			keyring = { status: 'absent' };
			return keyring;
		}

		// Handed over by the login or signup form a moment ago, so a fresh sign-in
		// does not ask for the same password twice in a row.
		const stashed = takeUnlock(normaliseEmail(user.email));
		if (stashed) {
			// Signup already has the identity in hand; login has to open a wrap.
			if (stashed.identity && stashed.recipient === bundle.recipient) {
				keyring = await cache(user.id, bundle.recipient, stashed.identity);
				return keyring;
			}
			const opened = await tryWraps(
				bundle.wraps.filter((wrap) => wrap.type === 'password'),
				bundle.recipient,
				async () => stashed.wrapKey
			);
			if (opened) {
				keyring = await cache(user.id, bundle.recipient, opened.identity);
				void noteWrapUsed(opened.wrapId);
				return keyring;
			}
		}

		keyring = {
			status: 'locked',
			recipient: bundle.recipient,
			wraps: bundle.wraps,
			reason: bundle.wraps.length === 0 ? 'no-usable-wrap' : 'cold'
		};
		return keyring;
	})();

	initialisingForUserId = user.id;
	initialisingPromise = run.finally(() => {
		if (initialisingForUserId === user.id) {
			initialisingForUserId = null;
			initialisingPromise = null;
		}
	});

	return initialisingPromise;
}

/** Unlocks with the account password. The ordinary path on a new device. */
export async function unlockWithPassword(
	user: { id: string; email: string },
	password: string
): Promise<Keyring> {
	if (keyring.status !== 'locked') return keyring;
	const { recipient, wraps } = keyring;

	// Cache the master key per parameter set: several wraps can share one, and
	// each derivation is 650,000 iterations. A plain object rather than a Map
	// because this is a scratch lookup inside one call and not state — a
	// SvelteMap here would add reactivity to something nothing observes.
	const masters: Record<string, MasterKey> = {};
	const opened = await tryWraps(
		wraps.filter((wrap) => wrap.type === 'password'),
		recipient,
		async (params) => {
			if (params.type !== 'password') return null;
			const cacheKey = `${params.version}:${params.iterations}`;
			masters[cacheKey] ??= await deriveMasterKey(password, user.email, {
				version: params.version,
				kdf: params.kdf,
				iterations: params.iterations
			});
			return deriveWrapKey(masters[cacheKey]);
		}
	);

	if (!opened) {
		// A local AES-GCM tag failure, with no server round trip — so a wrong
		// password is answered instantly and tells an observer nothing.
		keyring = { ...keyring, reason: 'wrong-password' };
		return keyring;
	}

	keyring = await cache(user.id, recipient, opened.identity);
	void noteWrapUsed(opened.wrapId);
	return keyring;
}

/**
 * Forgets the identity on this device.
 *
 * Note what this cannot do: another device that has already unlocked holds the
 * identity and needs neither the password nor this server to keep reading what
 * it has. Signing out revokes a session, not a key. See docs/encryption.md.
 */
export async function lock(userId: string): Promise<void> {
	clearStash();
	keyring = { status: 'unknown' };
	initialisingForUserId = null;
	initialisingPromise = null;
	const store = await keyStore();
	await store.clear(userId);
}

/** Drops in-memory state without touching storage, e.g. on a user change. */
export function resetKeyring(): void {
	clearStash();
	keyring = { status: 'unknown' };
	initialisingForUserId = null;
	initialisingPromise = null;
}

// ── server round trips ───────────────────────────────────────────────────────

async function fetchBundle(): Promise<UnlockBundleView> {
	const response = await fetch('/api/keys/unlock-bundle');
	if (!response.ok) throw new Error(`Could not load encryption keys (${response.status})`);
	return response.json();
}

/** Fire-and-forget: this is a display timestamp and gates nothing. */
async function noteWrapUsed(wrapId: string): Promise<void> {
	try {
		await fetch('/api/keys/wrap-used', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ wrapId })
		});
	} catch {
		// Not worth surfacing: the user is unlocked either way.
	}
}
