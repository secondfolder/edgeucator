/**
 * The age identity: generating one, deriving its public recipient, and caching
 * it as a key that cannot be stolen.
 *
 * BROWSER ONLY — see the note at the top of `kdf.ts`.
 *
 * `age-encryption` is reached only through `loadAge()` below, never with a
 * static import. It brings `@noble/post-quantum` (ML-KEM) with it for a feature
 * this app never uses, and the login and signup pages — the two a first-time
 * visitor loads — need none of it.
 */

/** What an age recipient looks like: `age1` plus 58 bech32 characters.
 *  The class is the bech32 charset exactly — no `1`, `b`, `i` or `o`. */
export const RECIPIENT_PATTERN = /^age1[02-9ac-hj-np-z]{58}$/;

/** What an age X25519 identity looks like. Uppercase bech32. */
export const IDENTITY_PREFIX = 'AGE-SECRET-KEY-1';

type Age = typeof import('age-encryption');

let agePromise: Promise<Age> | undefined;

/** Loads age-encryption once, on first use. See the file comment for why. */
export function loadAge(): Promise<Age> {
	return (agePromise ??= import('age-encryption'));
}

export type NewIdentity = {
	/** `AGE-SECRET-KEY-1…`. Wrap this; never store or log it as-is. */
	identity: string;
	/** `age1…`. Public, and stored in the clear server-side. */
	recipient: string;
};

/** A fresh long-term identity. Called once per user, ever — or once more after
 *  a forgotten password, which starts a partner-assisted history restore. */
export async function generateAgeIdentity(): Promise<NewIdentity> {
	const age = await loadAge();
	// generateIdentity() is documented as possibly returning a post-quantum
	// hybrid in future versions. Pin X25519 explicitly: the identity is cached
	// as a WebCrypto X25519 CryptoKey, and a hybrid identity has no such form.
	const identity = await age.generateX25519Identity();
	return { identity, recipient: await age.identityToRecipient(identity) };
}

/** The public recipient for an identity, given either form of it. */
export async function recipientFor(identity: string | CryptoKey): Promise<string> {
	const age = await loadAge();
	return age.identityToRecipient(identity);
}

/**
 * WebCrypto's ASN.1 preamble for a PKCS #8 X25519 private key.
 *
 * Lifted from age-encryption's own `x25519.ts`, and for its reason: WebCrypto
 * will only import an X25519 *private* key as PKCS #8 or JWK, never raw, and
 * since the scalar is always 32 bytes a fixed prefix is enough.
 */
const PKCS8_X25519_PREFIX = new Uint8Array([
	0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20
]);

/**
 * Turns an identity string into a **non-extractable** `CryptoKey`.
 *
 * This is the form the identity is cached in, and `extractable: false` is the
 * whole point: from here on there is no API anywhere that returns these bytes,
 * so script injected into the page can *use* the key but cannot walk away with
 * it. (It can still decrypt everything for as long as it runs — see
 * docs/encryption.md. This narrows the blast radius; it does not replace a CSP.)
 *
 * age-encryption accepts a `CryptoKey` for both `identityToRecipient` and
 * `Decrypter.addIdentity`, so nothing needs the string form afterwards.
 */
export async function importIdentityKey(identity: string): Promise<CryptoKey> {
	const { bech32 } = await import('@scure/base');
	// bech32 accepts the all-uppercase form and reports its prefix lowercased.
	const decoded = bech32.decodeToBytes(identity);
	if (decoded.prefix !== 'age-secret-key-') {
		throw new Error('Not an age X25519 identity');
	}
	if (decoded.bytes.length !== 32) {
		throw new Error(`Expected a 32-byte X25519 scalar, got ${decoded.bytes.length}`);
	}
	const pkcs8 = new Uint8Array([...PKCS8_X25519_PREFIX, ...decoded.bytes]);
	return crypto.subtle.importKey('pkcs8', pkcs8, { name: 'X25519' }, false, ['deriveBits']);
}

let x25519Probe: Promise<boolean> | undefined;

/**
 * Whether this browser can do X25519 in WebCrypto.
 *
 * A real generate-and-derive, not a capability sniff, and age-encryption's own
 * source says why: Bun implements `importKey` for X25519 but not `deriveBits`,
 * so anything short of actually deriving reports support that is not there.
 * There is no cheap correct check.
 *
 * This matters because the two paths differ. age falls back to `@noble/curves`
 * for *string* identities, but a `CryptoKey` identity throws outright
 * ("CryptoKey provided but X25519 WebCrypto is not supported"). So when this is
 * false, the identity is held as a string in memory and never persisted, and
 * the user is told they will be asked for their password each time.
 *
 * Memoised: it costs a keypair and a scalar multiplication.
 */
export function webCryptoX25519Available(): Promise<boolean> {
	return (x25519Probe ??= (async () => {
		try {
			const pair = (await crypto.subtle.generateKey({ name: 'X25519' }, false, [
				'deriveBits'
			])) as CryptoKeyPair;
			await crypto.subtle.deriveBits(
				{ name: 'X25519', public: pair.publicKey },
				pair.privateKey,
				256
			);
			return true;
		} catch {
			return false;
		}
	})());
}

/** Test seam: forget the memoised probe result. */
export function resetX25519Probe(): void {
	x25519Probe = undefined;
}
