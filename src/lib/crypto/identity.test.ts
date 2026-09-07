import { describe, expect, it } from 'vitest';
import {
	IDENTITY_PREFIX,
	RECIPIENT_PATTERN,
	generateAgeIdentity,
	importIdentityKey,
	loadAge,
	recipientFor,
	webCryptoX25519Available
} from './identity';

describe('generateAgeIdentity', () => {
	it('produces an X25519 identity and its recipient', async () => {
		const { identity, recipient } = await generateAgeIdentity();
		expect(identity.startsWith(IDENTITY_PREFIX)).toBe(true);
		expect(recipient).toMatch(RECIPIENT_PATTERN);
	});

	/**
	 * Pinned because `generateIdentity()` is documented as possibly returning a
	 * post-quantum hybrid in a future version, and a hybrid identity has no
	 * WebCrypto X25519 form — so the non-extractable CryptoKey cache, which is
	 * the whole local-storage story, would break silently on a minor upgrade.
	 */
	it('is never a post-quantum hybrid', async () => {
		const { identity } = await generateAgeIdentity();
		expect(identity.startsWith('AGE-SECRET-KEY-PQ-1')).toBe(false);
	});

	it('never repeats', async () => {
		const many = await Promise.all(Array.from({ length: 20 }, () => generateAgeIdentity()));
		expect(new Set(many.map((k) => k.recipient)).size).toBe(20);
	});

	it('matches the pattern the Zod schema will check', async () => {
		for (let i = 0; i < 25; i++) {
			const { recipient } = await generateAgeIdentity();
			expect(recipient).toMatch(RECIPIENT_PATTERN);
			expect(recipient).toHaveLength(62);
		}
	});
});

describe('webCryptoX25519Available', () => {
	// A real generate-and-derive, because there is no cheap correct check —
	// Bun implements importKey for X25519 but not deriveBits.
	it('is true on a runtime with X25519 (Node here, and every current browser)', async () => {
		await expect(webCryptoX25519Available()).resolves.toBe(true);
	});

	it('memoises, so the probe costs one keypair and not one per call', async () => {
		const first = webCryptoX25519Available();
		expect(webCryptoX25519Available()).toBe(first);
	});
});

describe('importIdentityKey', () => {
	it('gives a non-extractable X25519 key usable only for deriveBits', async () => {
		const { identity } = await generateAgeIdentity();
		const key = await importIdentityKey(identity);
		expect(key.algorithm.name).toBe('X25519');
		expect(key.type).toBe('private');
		expect([...key.usages]).toEqual(['deriveBits']);
		// The point of the whole exercise: script on the page can use this key
		// but there is no API that hands back its bytes.
		expect(key.extractable).toBe(false);
		await expect(crypto.subtle.exportKey('pkcs8', key)).rejects.toThrow();
	});

	it('rejects anything that is not an age X25519 identity', async () => {
		const { recipient } = await generateAgeIdentity();
		// A recipient is a valid bech32 string with the wrong prefix.
		await expect(importIdentityKey(recipient)).rejects.toThrow(/Not an age X25519 identity/);
		await expect(importIdentityKey('nonsense')).rejects.toThrow();
		await expect(importIdentityKey('')).rejects.toThrow();
	});

	it('rejects a hybrid identity, which has no X25519 CryptoKey form', async () => {
		const age = await loadAge();
		const hybrid = await age.generateHybridIdentity();
		await expect(importIdentityKey(hybrid)).rejects.toThrow();
	});
});

describe('recipientFor', () => {
	/**
	 * THE test that proves age-encryption accepts a CryptoKey identity.
	 *
	 * The cached identity is a non-extractable CryptoKey, so if a typage upgrade
	 * ever narrowed `identityToRecipient` to strings, every unlocked device
	 * would stop being able to work out its own public key. This fails loudly
	 * when that happens, instead of it surfacing as an unexplained blank screen.
	 */
	it('agrees between the identity string and the imported CryptoKey', async () => {
		const { identity, recipient } = await generateAgeIdentity();
		const key = await importIdentityKey(identity);
		await expect(recipientFor(key)).resolves.toBe(recipient);
		await expect(recipientFor(identity)).resolves.toBe(recipient);
	});
});

describe('the full circle', () => {
	/**
	 * Encrypt once to both partners, and have each of them open it independently
	 * — one from a non-extractable CryptoKey, one from a string. This is the
	 * shape every message in the feature has, and it is what makes "the server
	 * stores a copy both of us can read" true.
	 */
	it('lets both partners decrypt one ciphertext, and nobody else', async () => {
		const age = await loadAge();
		const ada = await generateAgeIdentity();
		const jun = await generateAgeIdentity();
		const stranger = await generateAgeIdentity();

		const encrypter = new age.Encrypter();
		encrypter.addRecipient(ada.recipient);
		encrypter.addRecipient(jun.recipient);
		const ciphertext = await encrypter.encrypt('meet me in the kitchen');

		// Ada unlocks from the cached CryptoKey, as a real device would.
		const adaDecrypter = new age.Decrypter();
		adaDecrypter.addIdentity(await importIdentityKey(ada.identity));
		await expect(adaDecrypter.decrypt(ciphertext, 'text')).resolves.toBe('meet me in the kitchen');

		const junDecrypter = new age.Decrypter();
		junDecrypter.addIdentity(jun.identity);
		await expect(junDecrypter.decrypt(ciphertext, 'text')).resolves.toBe('meet me in the kitchen');

		const strangerDecrypter = new age.Decrypter();
		strangerDecrypter.addIdentity(stranger.identity);
		// Throws rather than returning null — worth pinning, because the calling
		// code has to distinguish "not for me" from "corrupt".
		await expect(strangerDecrypter.decrypt(ciphertext, 'text')).rejects.toThrow(
			/no identity matched/
		);
	});

	it('carries no plaintext in the ciphertext', async () => {
		const age = await loadAge();
		const ada = await generateAgeIdentity();
		const encrypter = new age.Encrypter();
		encrypter.addRecipient(ada.recipient);
		const ciphertext = await encrypter.encrypt('a very distinctive phrase');
		expect(new TextDecoder().decode(ciphertext)).not.toContain('distinctive');
	});

	it('round-trips bytes, for the attachment path', async () => {
		const age = await loadAge();
		const { identity, recipient } = await generateAgeIdentity();
		const payload = crypto.getRandomValues(new Uint8Array(64 * 1024));

		const encrypter = new age.Encrypter();
		encrypter.addRecipient(recipient);
		const ciphertext = await encrypter.encrypt(payload);

		const decrypter = new age.Decrypter();
		decrypter.addIdentity(identity);
		const opened = await decrypter.decrypt(ciphertext, 'uint8array');
		expect(new Uint8Array(opened)).toEqual(payload);
	});
});
