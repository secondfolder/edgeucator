import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../testing/db';
import {
	createTestPartnership,
	createTestUser,
	createTestUserKeys,
	readUserKeysRow,
	readWrapRows,
	type TestUser
} from '../testing/fixtures';
import {
	ADA_RECIPIENT,
	FAKE_WRAP_BLOB,
	JUN_RECIPIENT,
	PASSWORD_WRAP_PARAMS
} from '../testing/crypto';
import {
	acknowledgeHistoryWarning,
	addWrap,
	deleteOtherPasswordWraps,
	deleteWrap,
	getRecipientsForPartnership,
	getUnlockBundle,
	getUserKeys,
	listWrapsForUser,
	putUserKeys,
	replaceUserKeys,
	touchWrap
} from './keys';

let harness: TestDb;
let ada: TestUser;
let jun: TestUser;

const passwordWrap = (blob = FAKE_WRAP_BLOB) =>
	({ type: 'password', params: PASSWORD_WRAP_PARAMS, blob }) as const;

beforeEach(async () => {
	harness = await createTestDb();
	ada = await createTestUser(harness.db, { name: 'Ada' });
	jun = await createTestUser(harness.db, { name: 'Jun' });
});

afterEach(() => harness.close());

describe('putUserKeys', () => {
	it('writes the recipient and its first wrap together', async () => {
		await putUserKeys(harness.db, ada.id, { recipient: ADA_RECIPIENT, wrap: passwordWrap() });

		await expect(getUserKeys(harness.db, ada.id)).resolves.toEqual({
			recipient: ADA_RECIPIENT,
			historyWarningAcknowledged: false
		});
		await expect(readWrapRows(harness.db, ada.id)).resolves.toHaveLength(1);
	});

	it('round-trips the JSON params rather than stringifying them', async () => {
		await putUserKeys(harness.db, ada.id, { recipient: ADA_RECIPIENT, wrap: passwordWrap() });
		const [wrap] = await listWrapsForUser(harness.db, ada.id);
		expect(wrap.params).toEqual(PASSWORD_WRAP_PARAMS);
	});

	/**
	 * Overwriting a recipient is how message history gets lost, so it has to go
	 * through `replaceUserKeys`, which says so in its name. The unique
	 * constraint is what makes that a rule rather than a convention.
	 */
	it('refuses a second set of keys for the same user', async () => {
		await putUserKeys(harness.db, ada.id, { recipient: ADA_RECIPIENT, wrap: passwordWrap() });
		await expect(
			putUserKeys(harness.db, ada.id, { recipient: JUN_RECIPIENT, wrap: passwordWrap() })
		).rejects.toThrow();
	});

	it('refuses keys for a user that does not exist', async () => {
		await expect(
			putUserKeys(harness.db, 'nobody', { recipient: ADA_RECIPIENT, wrap: passwordWrap() })
		).rejects.toThrow();
	});
});

describe('getUserKeys', () => {
	it('is null before setup', async () => {
		await expect(getUserKeys(harness.db, ada.id)).resolves.toBeNull();
	});

	it('reports the acknowledgement once it is given', async () => {
		await createTestUserKeys(harness.db, ada);
		await expect(getUserKeys(harness.db, ada.id)).resolves.toMatchObject({
			historyWarningAcknowledged: false
		});

		await acknowledgeHistoryWarning(harness.db, ada.id);
		await expect(getUserKeys(harness.db, ada.id)).resolves.toMatchObject({
			historyWarningAcknowledged: true
		});
	});
});

describe('listWrapsForUser', () => {
	it('never returns another user’s wraps', async () => {
		await createTestUserKeys(harness.db, ada);
		await createTestUserKeys(harness.db, jun);

		const adaWraps = await listWrapsForUser(harness.db, ada.id);
		const junWraps = await listWrapsForUser(harness.db, jun.id);
		expect(adaWraps).toHaveLength(1);
		expect(junWraps).toHaveLength(1);
		expect(adaWraps[0].id).not.toBe(junWraps[0].id);
	});

	it('is empty for a user with no keys', async () => {
		await expect(listWrapsForUser(harness.db, ada.id)).resolves.toEqual([]);
	});
});

describe('getUnlockBundle', () => {
	/**
	 * The state a malicious server could manufacture by deleting the wraps. The
	 * dangerous response would be to generate a fresh identity, which would
	 * permanently orphan every message the user had received — so the bundle has
	 * to report "key present, no way in" distinguishably from "not set up".
	 */
	it('reports a recipient with no wraps distinguishably from no keys at all', async () => {
		await expect(getUnlockBundle(harness.db, ada.id)).resolves.toEqual({
			recipient: null,
			historyWarningAcknowledged: false,
			wraps: []
		});

		await createTestUserKeys(harness.db, ada, { recipient: ADA_RECIPIENT });
		const [wrap] = await listWrapsForUser(harness.db, ada.id);
		await deleteWrap(harness.db, wrap.id, ada.id);

		await expect(getUnlockBundle(harness.db, ada.id)).resolves.toEqual({
			recipient: ADA_RECIPIENT,
			historyWarningAcknowledged: false,
			wraps: []
		});
	});
});

describe('addWrap + deleteOtherPasswordWraps', () => {
	/**
	 * The password-change sequence, and the reason the table has no unique index
	 * on (user_id, type): the new wrap is inserted before the credential
	 * changes, so both exist briefly and exactly one opens under whichever
	 * password is current.
	 */
	it('leaves exactly the surviving wrap', async () => {
		await createTestUserKeys(harness.db, ada);
		const newId = await addWrap(harness.db, ada.id, passwordWrap('bmV3LXdyYXA'));
		expect(await readWrapRows(harness.db, ada.id)).toHaveLength(2);

		await deleteOtherPasswordWraps(harness.db, ada.id, newId);
		const remaining = await readWrapRows(harness.db, ada.id);
		expect(remaining).toHaveLength(1);
		expect(remaining[0].id).toBe(newId);
		expect(remaining[0].blob).toBe('bmV3LXdyYXA');
	});

	it('keeps non-password wraps, so a passkey survives a password change', async () => {
		await createTestUserKeys(harness.db, ada);
		await addWrap(harness.db, ada.id, {
			type: 'webauthn-prf',
			params: { type: 'webauthn-prf', version: 1, credentialId: 'cred', salt: 'c2FsdA' },
			blob: FAKE_WRAP_BLOB,
			label: 'iPhone passkey'
		});
		const newId = await addWrap(harness.db, ada.id, passwordWrap('bmV3'));

		await deleteOtherPasswordWraps(harness.db, ada.id, newId);
		const types = (await readWrapRows(harness.db, ada.id)).map((w) => w.type).sort();
		expect(types).toEqual(['password', 'webauthn-prf']);
	});

	it('does not touch another user’s wraps', async () => {
		await createTestUserKeys(harness.db, ada);
		await createTestUserKeys(harness.db, jun);
		const adaNew = await addWrap(harness.db, ada.id, passwordWrap('bmV3'));

		await deleteOtherPasswordWraps(harness.db, ada.id, adaNew);
		expect(await readWrapRows(harness.db, jun.id)).toHaveLength(1);
	});
});

describe('deleteWrap', () => {
	it('removes only the owner’s wrap', async () => {
		await createTestUserKeys(harness.db, ada);
		const [wrap] = await listWrapsForUser(harness.db, ada.id);

		await expect(deleteWrap(harness.db, wrap.id, jun.id)).resolves.toBe(false);
		expect(await readWrapRows(harness.db, ada.id)).toHaveLength(1);

		await expect(deleteWrap(harness.db, wrap.id, ada.id)).resolves.toBe(true);
		expect(await readWrapRows(harness.db, ada.id)).toHaveLength(0);
	});
});

describe('touchWrap', () => {
	it('records a successful unlock, scoped to the owner', async () => {
		await createTestUserKeys(harness.db, ada);
		const [wrap] = await listWrapsForUser(harness.db, ada.id);
		expect(wrap.lastUsedAt).toBeNull();

		await touchWrap(harness.db, wrap.id, jun.id);
		expect((await listWrapsForUser(harness.db, ada.id))[0].lastUsedAt).toBeNull();

		await touchWrap(harness.db, wrap.id, ada.id);
		expect((await listWrapsForUser(harness.db, ada.id))[0].lastUsedAt).toBeInstanceOf(Date);
	});
});

describe('replaceUserKeys', () => {
	it('swaps the recipient and leaves exactly one new wrap', async () => {
		await createTestUserKeys(harness.db, ada, { recipient: ADA_RECIPIENT, acknowledged: true });
		await addWrap(harness.db, ada.id, passwordWrap('c3RhbGU'));

		await replaceUserKeys(harness.db, ada.id, {
			recipient: JUN_RECIPIENT,
			wrap: passwordWrap('ZnJlc2g')
		});

		const row = await readUserKeysRow(harness.db, ada.id);
		expect(row.recipient).toBe(JUN_RECIPIENT);
		const wraps = await readWrapRows(harness.db, ada.id);
		expect(wraps).toHaveLength(1);
		expect(wraps[0].blob).toBe('ZnJlc2g');
	});

	// A new identity means new history to lose, so the warning is owed again.
	it('clears the history-warning acknowledgement', async () => {
		await createTestUserKeys(harness.db, ada, { acknowledged: true });
		await replaceUserKeys(harness.db, ada.id, {
			recipient: JUN_RECIPIENT,
			wrap: passwordWrap()
		});
		await expect(getUserKeys(harness.db, ada.id)).resolves.toMatchObject({
			historyWarningAcknowledged: false
		});
	});

	it('leaves the other user alone', async () => {
		await createTestUserKeys(harness.db, ada, { recipient: ADA_RECIPIENT });
		const junKeys = await createTestUserKeys(harness.db, jun);
		await replaceUserKeys(harness.db, ada.id, {
			recipient: JUN_RECIPIENT,
			wrap: passwordWrap()
		});
		await expect(getUserKeys(harness.db, jun.id)).resolves.toMatchObject({
			recipient: junKeys.recipient
		});
	});
});

describe('getRecipientsForPartnership', () => {
	it('resolves mine/theirs from each side of the same row', async () => {
		const adaKeys = await createTestUserKeys(harness.db, ada);
		const junKeys = await createTestUserKeys(harness.db, jun);
		const partnership = await createTestPartnership(harness.db, ada, jun);

		await expect(getRecipientsForPartnership(harness.db, partnership.id, ada.id)).resolves.toEqual({
			mine: adaKeys.recipient,
			theirs: junKeys.recipient
		});

		// The per-viewer flip, which is the same trap as the name columns.
		await expect(getRecipientsForPartnership(harness.db, partnership.id, jun.id)).resolves.toEqual({
			mine: junKeys.recipient,
			theirs: adaKeys.recipient
		});
	});

	/**
	 * LEFT joins on both sides. An inner join would make the whole partnership
	 * vanish because one of the two had not set up messaging, which the UI would
	 * render as "no such partner" rather than "they haven't set this up yet".
	 */
	it('returns nulls rather than nothing when a key is missing', async () => {
		const adaKeys = await createTestUserKeys(harness.db, ada);
		const partnership = await createTestPartnership(harness.db, ada, jun);

		await expect(getRecipientsForPartnership(harness.db, partnership.id, ada.id)).resolves.toEqual({
			mine: adaKeys.recipient,
			theirs: null
		});
		await expect(getRecipientsForPartnership(harness.db, partnership.id, jun.id)).resolves.toEqual({
			mine: null,
			theirs: adaKeys.recipient
		});
	});

	it('is null for someone who is not in the partnership', async () => {
		await createTestUserKeys(harness.db, ada);
		const partnership = await createTestPartnership(harness.db, ada, jun);
		const stranger = await createTestUser(harness.db);

		await expect(
			getRecipientsForPartnership(harness.db, partnership.id, stranger.id)
		).resolves.toBeNull();
	});

	// There is nobody to encrypt to yet, and no second person to compare a
	// safety number with.
	it('is null for a pending invite', async () => {
		const { createTestInvite } = await import('../testing/fixtures');
		const invite = await createTestInvite(harness.db, ada);
		await expect(getRecipientsForPartnership(harness.db, invite.id, ada.id)).resolves.toBeNull();
	});

	it('is null for an id that does not exist', async () => {
		await expect(getRecipientsForPartnership(harness.db, 'nope', ada.id)).resolves.toBeNull();
	});
});
