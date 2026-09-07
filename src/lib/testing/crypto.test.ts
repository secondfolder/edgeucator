import { describe, expect, it } from 'vitest';
import { loadAge, RECIPIENT_PATTERN } from '../crypto/identity';
import {
	ADA_IDENTITY,
	ADA_RECIPIENT,
	FAKE_WRAP_BLOB,
	JUN_IDENTITY,
	JUN_RECIPIENT,
	STRANGER_IDENTITY,
	STRANGER_RECIPIENT
} from './crypto';

/**
 * A guard on the fixtures themselves.
 *
 * `crypto.ts` claims to hold real age keypairs, and server tests lean on that
 * claim — a hand-made recipient would pass a regex but fail its bech32
 * checksum, so a corrupted paste here would surface later as a baffling
 * failure in an unrelated test. Cheaper to assert it once, at the source.
 */
describe('frozen test key material', () => {
	const pairs = [
		['ADA', ADA_IDENTITY, ADA_RECIPIENT],
		['JUN', JUN_IDENTITY, JUN_RECIPIENT],
		['STRANGER', STRANGER_IDENTITY, STRANGER_RECIPIENT]
	] as const;

	it('is three distinct real keypairs', async () => {
		const age = await loadAge();
		for (const [name, identity, recipient] of pairs) {
			expect(recipient, name).toMatch(RECIPIENT_PATTERN);
			await expect(age.identityToRecipient(identity), name).resolves.toBe(recipient);
		}
		expect(new Set(pairs.map(([, , r]) => r)).size).toBe(3);
	});

	it('really does let Ada and Jun read one ciphertext, and not the stranger', async () => {
		const age = await loadAge();
		const encrypter = new age.Encrypter();
		encrypter.addRecipient(ADA_RECIPIENT);
		encrypter.addRecipient(JUN_RECIPIENT);
		const ciphertext = await encrypter.encrypt('fixture');

		for (const identity of [ADA_IDENTITY, JUN_IDENTITY]) {
			const decrypter = new age.Decrypter();
			decrypter.addIdentity(identity);
			await expect(decrypter.decrypt(ciphertext, 'text')).resolves.toBe('fixture');
		}

		const outsider = new age.Decrypter();
		outsider.addIdentity(STRANGER_IDENTITY);
		await expect(outsider.decrypt(ciphertext, 'text')).rejects.toThrow();
	});

	// The server never opens a wrap, so this only has to satisfy the Zod field.
	it('has a wrap blob shaped like base64url', () => {
		expect(FAKE_WRAP_BLOB).toMatch(/^[A-Za-z0-9_-]+$/);
	});
});
