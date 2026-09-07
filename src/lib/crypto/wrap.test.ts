import { describe, expect, it } from 'vitest';
import { fromBase64Url, toBase64Url } from '../encryption';
import { unwrapIdentity, wrapIdentity } from './wrap';

const IDENTITY = 'AGE-SECRET-KEY-1F5PRQQ7DXHQXFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFA';
const RECIPIENT = 'age1trrfc8jekhtaalglq59kh7v95xvfpsn9tsu6k8vhselxm0s2592su84zu9';
const OTHER_RECIPIENT = 'age1qqqqc8jekhtaalglq59kh7v95xvfpsn9tsu6k8vhselxm0s2592sqqqqqq';

/** A wrap key straight from raw bytes — independent of the KDF, which has its
 *  own tests, so a failure here points at the envelope and not at PBKDF2. */
async function aesKey(seed = 1): Promise<CryptoKey> {
	const raw = new Uint8Array(32).fill(seed);
	return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

describe('wrapIdentity / unwrapIdentity', () => {
	it('round-trips the identity exactly', async () => {
		const wrapKey = await aesKey();
		const blob = await wrapIdentity({ wrapKey, identity: IDENTITY, recipient: RECIPIENT });
		await expect(unwrapIdentity({ wrapKey, blob, recipient: RECIPIENT })).resolves.toBe(IDENTITY);
	});

	it('produces a base64url blob with room for an IV and a tag', async () => {
		const blob = await wrapIdentity({
			wrapKey: await aesKey(),
			identity: IDENTITY,
			recipient: RECIPIENT
		});
		expect(blob).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(fromBase64Url(blob).length).toBe(12 + IDENTITY.length + 16);
	});

	/**
	 * A fresh IV on every wrap, and this is not cosmetic: AES-GCM loses all
	 * confidentiality if an IV repeats under the same key, and the same identity
	 * is re-wrapped on every password change.
	 */
	it('never reuses an IV', async () => {
		const wrapKey = await aesKey();
		const blobs = await Promise.all(
			Array.from({ length: 50 }, () =>
				wrapIdentity({ wrapKey, identity: IDENTITY, recipient: RECIPIENT })
			)
		);
		expect(new Set(blobs).size).toBe(50);
		const ivs = blobs.map((blob) => toBase64Url(fromBase64Url(blob).subarray(0, 12)));
		expect(new Set(ivs).size).toBe(50);
	});

	// "Wrong password" is an ordinary outcome the unlock screen renders as a
	// message, so it is a value and not an exception.
	it('returns null for the wrong wrap key', async () => {
		const blob = await wrapIdentity({
			wrapKey: await aesKey(1),
			identity: IDENTITY,
			recipient: RECIPIENT
		});
		await expect(
			unwrapIdentity({ wrapKey: await aesKey(2), blob, recipient: RECIPIENT })
		).resolves.toBeNull();
	});

	/**
	 * The AAD binding. A wrap row lifted into another account fails its tag
	 * check rather than decrypting into someone else's identity.
	 */
	it('returns null when the recipient in the AAD does not match', async () => {
		const wrapKey = await aesKey();
		const blob = await wrapIdentity({ wrapKey, identity: IDENTITY, recipient: RECIPIENT });
		await expect(unwrapIdentity({ wrapKey, blob, recipient: OTHER_RECIPIENT })).resolves.toBeNull();
	});

	it('returns null when any byte of the ciphertext is flipped', async () => {
		const wrapKey = await aesKey();
		const blob = await wrapIdentity({ wrapKey, identity: IDENTITY, recipient: RECIPIENT });
		const bytes = fromBase64Url(blob);
		for (const index of [0, 11, 12, 20, bytes.length - 1]) {
			const tampered = Uint8Array.from(bytes);
			tampered[index] ^= 0x01;
			await expect(
				unwrapIdentity({ wrapKey, blob: toBase64Url(tampered), recipient: RECIPIENT })
			).resolves.toBeNull();
		}
	});

	/**
	 * Corrupt storage is a different problem from a wrong password, and
	 * reporting it as one would send whoever hit it looking in the wrong place.
	 * So malformed input throws while a failed tag check returns null.
	 */
	it('throws rather than returning null for a malformed blob', async () => {
		const wrapKey = await aesKey();
		await expect(
			unwrapIdentity({ wrapKey, blob: 'not base64url!', recipient: RECIPIENT })
		).rejects.toThrow(/base64url/);
		await expect(
			unwrapIdentity({ wrapKey, blob: toBase64Url(new Uint8Array(12)), recipient: RECIPIENT })
		).rejects.toThrow(/too short/);
		await expect(unwrapIdentity({ wrapKey, blob: '', recipient: RECIPIENT })).rejects.toThrow(
			/too short/
		);
	});

	it('handles an identity with multi-byte characters, in case one ever appears', async () => {
		const wrapKey = await aesKey();
		const odd = 'AGE-SECRET-KEY-1 — naïve 🔐';
		const blob = await wrapIdentity({ wrapKey, identity: odd, recipient: RECIPIENT });
		await expect(unwrapIdentity({ wrapKey, blob, recipient: RECIPIENT })).resolves.toBe(odd);
	});
});
