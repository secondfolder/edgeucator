import { describe, expect, it } from 'vitest';
import {
	AUTH_SECRET_LENGTH,
	AUTH_SECRET_PATTERN,
	MASTER_KEY_V1,
	type MasterKeyParams
} from '../encryption';
import { deriveAuthSecret, deriveMasterKey, deriveWrapKey, deriveWrapKeyFromPrf } from './kdf';

/**
 * The real work factor is 650,000 iterations. That is ~85 ms in Node, so it is
 * affordable once — for the frozen vector below, which has to run against the
 * shipping parameters or it proves nothing. Everything else uses this, because
 * a hundred tests at the real factor is nine seconds of nothing.
 *
 * `version` stays 1 so the salt string is identical to production's; only the
 * cost differs.
 */
const CHEAP: MasterKeyParams = { version: 1, kdf: 'PBKDF2-SHA256', iterations: 1000 };

describe('deriveMasterKey + deriveAuthSecret', () => {
	/**
	 * THE MOST IMPORTANT TEST IN THIS FEATURE.
	 *
	 * This value is what every existing account's password derives to. If a
	 * refactor changes the salt string, the iteration count, the HKDF info, the
	 * base64 alphabet, or the email normalisation, this number moves — and every
	 * user is silently locked out of their own message history with no way to
	 * get back in, because the wrap key moves with it.
	 *
	 * Computed once, against the shipping parameters. Do not "update" it to make
	 * a failing build green: a change here means the change that caused it is
	 * a breaking one, and needs the migration path in docs/encryption.md.
	 *
	 * The vector below is the third one this file has frozen. The first was
	 * computed against the pre-launch `edgeucator-*` domain strings and was
	 * refreshed when the app was renamed to Bound Up; the second was computed
	 * against the unhyphenated `boundup-*` strings and was refreshed — again
	 * deliberately, accounts and all — when those were hyphenated to
	 * `bound-up-*` before launch. No account exists from either predecessor.
	 */
	it('matches the frozen vector for the shipping parameters', async () => {
		const master = await deriveMasterKey('correct-horse-battery', 'ada@example.test');
		expect(master.params).toBe(MASTER_KEY_V1);
		await expect(deriveAuthSecret(master)).resolves.toBe(
			'BKfC6un0lJPt7d1_rFl-_eYH_frFSwXaP44xMDZZ9PQ'
		);
	});

	it('is deterministic', async () => {
		const once = await deriveAuthSecret(await deriveMasterKey('pw', 'a@x.test', CHEAP));
		const twice = await deriveAuthSecret(await deriveMasterKey('pw', 'a@x.test', CHEAP));
		expect(once).toBe(twice);
	});

	it('has the shape the server validates', async () => {
		const secret = await deriveAuthSecret(await deriveMasterKey('pw', 'a@x.test', CHEAP));
		expect(secret).toHaveLength(AUTH_SECRET_LENGTH);
		expect(secret).toMatch(AUTH_SECRET_PATTERN);
	});

	it('changes with the password', async () => {
		const a = await deriveAuthSecret(await deriveMasterKey('pw1', 'a@x.test', CHEAP));
		const b = await deriveAuthSecret(await deriveMasterKey('pw2', 'a@x.test', CHEAP));
		expect(a).not.toBe(b);
	});

	// So a wrong email cannot produce a right auth secret. This is also what
	// makes the login 401 indistinguishable in both directions.
	it('changes with the email', async () => {
		const a = await deriveAuthSecret(await deriveMasterKey('pw', 'a@x.test', CHEAP));
		const b = await deriveAuthSecret(await deriveMasterKey('pw', 'b@x.test', CHEAP));
		expect(a).not.toBe(b);
	});

	it('normalises the email, so case and stray spaces still reach the same key', async () => {
		const plain = await deriveAuthSecret(await deriveMasterKey('pw', 'ada@example.test', CHEAP));
		for (const spelling of [' ada@example.test ', 'ADA@EXAMPLE.TEST', 'Ada@Example.Test']) {
			await expect(deriveAuthSecret(await deriveMasterKey('pw', spelling, CHEAP))).resolves.toBe(
				plain
			);
		}
	});

	it('changes with the iteration count, so the ladder can tell versions apart', async () => {
		const a = await deriveAuthSecret(await deriveMasterKey('pw', 'a@x.test', CHEAP));
		const b = await deriveAuthSecret(
			await deriveMasterKey('pw', 'a@x.test', { ...CHEAP, iterations: 2000 })
		);
		expect(a).not.toBe(b);
	});

	it('keeps the master key non-extractable', async () => {
		const master = await deriveMasterKey('pw', 'a@x.test', CHEAP);
		expect(master.key.extractable).toBe(false);
		await expect(crypto.subtle.exportKey('raw', master.key)).rejects.toThrow();
	});
});

describe('deriveWrapKey', () => {
	it('is an AES-256-GCM key that cannot be exported', async () => {
		const key = await deriveWrapKey(await deriveMasterKey('pw', 'a@x.test', CHEAP));
		expect(key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
		expect(key.extractable).toBe(false);
		expect([...key.usages].sort()).toEqual(['decrypt', 'encrypt']);
		await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
	});

	/**
	 * The separation the whole design rests on: the server holds the auth secret,
	 * and it must not be able to get from that to the key that decrypts anything.
	 *
	 * Both come from one master key via HKDF with different `info` strings, so
	 * this is really a test that the two `info` constants are distinct — but that
	 * is exactly the thing a careless edit would break.
	 */
	it('is unrelated to the auth secret derived from the same master key', async () => {
		const master = await deriveMasterKey('pw', 'a@x.test', CHEAP);
		const secret = await deriveAuthSecret(master);
		const wrapKey = await deriveWrapKey(master);

		// The wrap key is non-extractable, so compare through what it produces.
		const iv = new Uint8Array(12);
		const sealed = new Uint8Array(
			await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrapKey, new Uint8Array([0]))
		);
		const asSecret = new TextEncoder().encode(secret);
		expect(sealed.slice(0, 16)).not.toEqual(asSecret.slice(0, 16));
	});

	it('differs between two passwords', async () => {
		const iv = new Uint8Array(12);
		const seal = async (password: string) => {
			const key = await deriveWrapKey(await deriveMasterKey(password, 'a@x.test', CHEAP));
			return new Uint8Array(
				await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new Uint8Array([1, 2, 3]))
			);
		};
		expect(await seal('pw1')).not.toEqual(await seal('pw2'));
	});
});

describe('deriveWrapKeyFromPrf', () => {
	const prf = () => crypto.getRandomValues(new Uint8Array(32)).buffer;

	it('produces the same kind of key as the password path', async () => {
		const key = await deriveWrapKeyFromPrf(prf());
		expect(key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
		expect(key.extractable).toBe(false);
		expect([...key.usages].sort()).toEqual(['decrypt', 'encrypt']);
	});

	it('is deterministic for the same PRF output', async () => {
		const output = prf();
		const iv = new Uint8Array(12);
		const seal = async () => {
			const key = await deriveWrapKeyFromPrf(output);
			return new Uint8Array(
				await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new Uint8Array([7]))
			);
		};
		expect(await seal()).toEqual(await seal());
	});

	it('refuses a PRF output too short to be a key', async () => {
		await expect(deriveWrapKeyFromPrf(new Uint8Array(16).buffer)).rejects.toThrow(/at least 32/);
	});
});
