/**
 * Sealing the age identity under a key derived from a password or a passkey.
 *
 * BROWSER ONLY — see the note at the top of `kdf.ts`.
 *
 * One AES-256-GCM envelope, and only one, whatever the wrap key came from:
 *
 *     blob = base64url( 12-byte IV || ciphertext || 16-byte tag )
 *     aad  = "bound-up-wrap-v1|" + recipient
 *
 * age's own passphrase mode is deliberately not used here. It would run scrypt
 * over a value that is already the output of 650,000 PBKDF2 iterations — a
 * second KDF buying nothing — and it would give the server a blob whose format
 * implies a passphrase it does not have.
 */

import { fromBase64Url, toBase64Url, wrapAad } from '../encryption';

const IV_BYTES = 12;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Seals `identity` (an `AGE-SECRET-KEY-1…` string) under `wrapKey`.
 *
 * The AAD binds the blob to the public key it belongs to, so a wrap row moved
 * to another account fails its tag check rather than decrypting into someone
 * else's identity.
 */
export async function wrapIdentity(input: {
	wrapKey: CryptoKey;
	identity: string;
	recipient: string;
}): Promise<string> {
	// A fresh IV per wrap, never derived and never reused: AES-GCM loses all
	// confidentiality if an IV repeats under the same key, and the same identity
	// gets re-wrapped on every password change.
	const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
	const sealed = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv, additionalData: encoder.encode(wrapAad(input.recipient)) },
		input.wrapKey,
		encoder.encode(input.identity)
	);

	const blob = new Uint8Array(IV_BYTES + sealed.byteLength);
	blob.set(iv, 0);
	blob.set(new Uint8Array(sealed), IV_BYTES);
	return toBase64Url(blob);
}

/**
 * Opens a wrap, or returns null when the key is wrong.
 *
 * Null rather than a throw for a failed tag check, because "wrong password" is
 * an ordinary outcome that the unlock screen has to render as a message. A
 * *malformed* blob still throws: that is a different problem — corrupt or
 * tampered storage — and silently reporting it as a bad password would send
 * whoever hits it looking in entirely the wrong place.
 */
export async function unwrapIdentity(input: {
	wrapKey: CryptoKey;
	blob: string;
	recipient: string;
}): Promise<string | null> {
	const bytes = fromBase64Url(input.blob);
	if (bytes.length <= IV_BYTES) {
		throw new Error('Key wrap is too short to contain an IV and a tag');
	}

	try {
		const opened = await crypto.subtle.decrypt(
			{
				name: 'AES-GCM',
				iv: bytes.subarray(0, IV_BYTES),
				additionalData: encoder.encode(wrapAad(input.recipient))
			},
			input.wrapKey,
			bytes.subarray(IV_BYTES)
		);
		return decoder.decode(opened);
	} catch (error) {
		// WebCrypto reports every authentication failure as OperationError with no
		// detail, which is correct of it — distinguishing "wrong key" from "wrong
		// AAD" from "flipped byte" would be an oracle. Anything else is a real bug.
		if (error instanceof DOMException && error.name === 'OperationError') return null;
		throw error;
	}
}
