import { describe, expect, it } from 'vitest';
import { AUTH_SECRET_PATTERN, parseKeyWrapParams } from '../encryption';
import { RECIPIENT_PATTERN, loadAge } from './identity';
import { buildIdentitySubmission, buildPasswordChange, currentPasswordWrapParams } from './setup';
import { unwrapIdentity } from './wrap';
import { deriveMasterKey, deriveWrapKey } from './kdf';
import type { KeyWrapView } from '../types';

const EMAIL = 'ada@example.test';
const OLD = 'correct-horse-battery';
const NEW = 'vocalist-hazy-radar-plunge';

/** A wrap row as the server would return it. */
function wrapView(blob: string, over: Partial<KeyWrapView> = {}): KeyWrapView {
	return {
		id: crypto.randomUUID(),
		type: 'password',
		params: currentPasswordWrapParams(),
		blob,
		label: null,
		lastUsedAt: null,
		createdAt: new Date(),
		...over
	};
}

describe('buildIdentitySubmission', () => {
	it('produces every field the action needs, in the right shape', async () => {
		const built = await buildIdentitySubmission(EMAIL, OLD);
		expect(built.authSecret).toMatch(AUTH_SECRET_PATTERN);
		expect(built.recipient).toMatch(RECIPIENT_PATTERN);
		expect(built.wrapBlob).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(parseKeyWrapParams(built.wrapParams)).toMatchObject({
			type: 'password',
			kdf: 'PBKDF2-SHA256'
		});
	});

	it('seals an identity the same password can open again', async () => {
		const built = await buildIdentitySubmission(EMAIL, OLD);
		const wrapKey = await deriveWrapKey(await deriveMasterKey(OLD, EMAIL));
		await expect(
			unwrapIdentity({ wrapKey, blob: built.wrapBlob, recipient: built.recipient })
		).resolves.toBe(built.identity);
	});

	it('seals one a different password cannot', async () => {
		const built = await buildIdentitySubmission(EMAIL, OLD);
		const wrongKey = await deriveWrapKey(await deriveMasterKey(NEW, EMAIL));
		await expect(
			unwrapIdentity({ wrapKey: wrongKey, blob: built.wrapBlob, recipient: built.recipient })
		).resolves.toBeNull();
	});

	it('never produces the same identity twice', async () => {
		const a = await buildIdentitySubmission(EMAIL, OLD);
		const b = await buildIdentitySubmission(EMAIL, OLD);
		expect(a.recipient).not.toBe(b.recipient);
	});
});

describe('buildPasswordChange', () => {
	async function existing() {
		const built = await buildIdentitySubmission(EMAIL, OLD);
		return { built, wraps: [wrapView(built.wrapBlob)] };
	}

	/**
	 * The property that makes changing a password different from forgetting
	 * one: the identity is carried across, so every message ever sent stays
	 * readable. If this ever re-generated instead, the failure would be silent
	 * and total.
	 */
	it('keeps the same identity, re-sealed under the new password', async () => {
		const { built, wraps } = await existing();
		const change = await buildPasswordChange({
			email: EMAIL,
			oldPassword: OLD,
			newPassword: NEW,
			recipient: built.recipient,
			wraps
		});
		expect(change).not.toBeNull();

		const newKey = await deriveWrapKey(await deriveMasterKey(NEW, EMAIL));
		await expect(
			unwrapIdentity({ wrapKey: newKey, blob: change!.wrapBlob, recipient: built.recipient })
		).resolves.toBe(built.identity);
	});

	it('carries an auth secret for each password', async () => {
		const { built, wraps } = await existing();
		const change = await buildPasswordChange({
			email: EMAIL,
			oldPassword: OLD,
			newPassword: NEW,
			recipient: built.recipient,
			wraps
		});
		const oldSecret = await import('./kdf').then(async (m) =>
			m.deriveAuthSecret(await m.deriveMasterKey(OLD, EMAIL))
		);
		const newSecret = await import('./kdf').then(async (m) =>
			m.deriveAuthSecret(await m.deriveMasterKey(NEW, EMAIL))
		);
		expect(change!.currentAuthSecret).toBe(oldSecret);
		expect(change!.newAuthSecret).toBe(newSecret);
	});

	/**
	 * The wrong current password is caught here, on the device, before anything
	 * is sent — so the server is never asked to distinguish "wrong password"
	 * from "wrong everything", and the user is told instantly.
	 */
	it('returns null for the wrong current password, without touching the server', async () => {
		const { built, wraps } = await existing();
		await expect(
			buildPasswordChange({
				email: EMAIL,
				oldPassword: 'not-the-password-at-all',
				newPassword: NEW,
				recipient: built.recipient,
				wraps
			})
		).resolves.toBeNull();
	});

	/**
	 * Two password wraps coexisting is a required transient state — a previous
	 * change inserts the new one before changing the credential — so this has
	 * to try each rather than assuming the first.
	 */
	it('finds the identity when a stale wrap is listed first', async () => {
		const { built } = await existing();
		const stale = await buildIdentitySubmission(EMAIL, 'some-other-password');
		const wraps = [wrapView(stale.wrapBlob), wrapView(built.wrapBlob)];

		const change = await buildPasswordChange({
			email: EMAIL,
			oldPassword: OLD,
			newPassword: NEW,
			recipient: built.recipient,
			wraps
		});
		expect(change).not.toBeNull();
		const newKey = await deriveWrapKey(await deriveMasterKey(NEW, EMAIL));
		await expect(
			unwrapIdentity({ wrapKey: newKey, blob: change!.wrapBlob, recipient: built.recipient })
		).resolves.toBe(built.identity);
	});

	it('ignores non-password wraps', async () => {
		const { built } = await existing();
		const wraps = [
			wrapView(built.wrapBlob, {
				type: 'webauthn-prf',
				params: { type: 'webauthn-prf', version: 1, credentialId: 'c', salt: 's' }
			})
		];
		await expect(
			buildPasswordChange({
				email: EMAIL,
				oldPassword: OLD,
				newPassword: NEW,
				recipient: built.recipient,
				wraps
			})
		).resolves.toBeNull();
	});

	/** The whole point, end to end: a message survives the password change. */
	it('leaves an already-encrypted message readable afterwards', async () => {
		const age = await loadAge();
		const { built, wraps } = await existing();

		const encrypter = new age.Encrypter();
		encrypter.addRecipient(built.recipient);
		const ciphertext = await encrypter.encrypt('sent before the change');

		const change = await buildPasswordChange({
			email: EMAIL,
			oldPassword: OLD,
			newPassword: NEW,
			recipient: built.recipient,
			wraps
		});
		const newKey = await deriveWrapKey(await deriveMasterKey(NEW, EMAIL));
		const identity = await unwrapIdentity({
			wrapKey: newKey,
			blob: change!.wrapBlob,
			recipient: built.recipient
		});

		const decrypter = new age.Decrypter();
		decrypter.addIdentity(identity!);
		await expect(decrypter.decrypt(ciphertext, 'text')).resolves.toBe('sent before the change');
	});
});
