import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { actions, load } from './+page.server';
import type { Db } from '$lib/server/db';
import { createTestDb, type TestDb } from '$lib/testing/db';
import {
	createTestInvite,
	createTestPartnership,
	createTestUser,
	expireInvite,
	readPartnershipRow,
	type TestUser
} from '$lib/testing/fixtures';
import { fakeEvent, runAndCatch, runLoad } from '$lib/testing/events';
import { findPendingInviteByToken } from '$lib/server/partnerships';

let harness: TestDb;
let db: Db;
let ada: TestUser;
let jun: TestUser;
let stranger: TestUser;

beforeEach(async () => {
	harness = await createTestDb();
	db = harness.db;
	ada = await createTestUser(db, { name: 'Ada' });
	jun = await createTestUser(db, { name: 'Jun' });
	stranger = await createTestUser(db, { name: 'Stranger' });
});

afterEach(() => harness.close());

const at = (id: string, user: TestUser | null, formData?: Record<string, string>) =>
	fakeEvent({ db, user, params: { id }, formData, path: `/settings/partners/${id}` });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (name: keyof typeof actions, ...args: Parameters<any>) =>
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(actions[name] as any)(...args);

describe('load', () => {
	test('gives the inviter the live invite link', async () => {
		const invite = await createTestInvite(db, ada);
		const data = await runLoad(load(at(invite.id, ada)));

		expect(data.partnership.status).toBe('pending');
		expect(data.inviteUrl).toBe(`https://app.test/invite/${invite.inviteToken}`);
		expect(data.inviteExpired).toBe(false);
	});

	test('withholds the link once the invite has expired', async () => {
		const invite = await createTestInvite(db, ada);
		await expireInvite(db, invite.id);

		const data = await runLoad(load(at(invite.id, ada)));
		expect(data.inviteUrl).toBeNull();
		expect(data.inviteExpired).toBe(true);
	});

	test('never puts a token in the page data of an accepted link', async () => {
		const { id } = await createTestPartnership(db, ada, jun);
		const data = await runLoad(load(at(id, ada)));
		expect(data.inviteUrl).toBeNull();
		expect(JSON.stringify(data)).not.toMatch(/invite\//);
	});

	test('404s for a partnership belonging to someone else', async () => {
		// 404 rather than 403: a 403 would confirm the id is real.
		const { id } = await createTestPartnership(db, ada, jun);
		const result = await runAndCatch(() => runLoad(load(at(id, stranger))));
		expect(result).toMatchObject({ type: 'error', status: 404 });
	});

	test('404s for an id that does not exist', async () => {
		const result = await runAndCatch(() => runLoad(load(at('nope', ada))));
		expect(result).toMatchObject({ type: 'error', status: 404 });
	});

	test('prefills the edit form from the viewer’s own side', async () => {
		const { id } = await createTestPartnership(db, ada, jun, {
			yourName: 'Ada',
			partnerName: 'Jun',
			control: 'me'
		});

		const forAda = await runLoad(load(at(id, ada)));
		expect(forAda.partnerEditForm.data).toMatchObject({
			partnerName: 'Jun',
			yourName: 'Ada',
			control: 'me'
		});
		expect(forAda.partnership.canEdit).toBe(true);

		const forJun = await runLoad(load(at(id, jun)));
		expect(forJun.partnerEditForm.data).toMatchObject({
			partnerName: 'Ada',
			yourName: 'Jun',
			// The same stored value reads as "them" from the other side.
			control: 'them'
		});
		expect(forJun.partnership.canEdit).toBe(false);
	});
});

describe('the update action', () => {
	const edit = {
		partnerName: 'Jun II',
		yourName: 'Ada II',
		partnerRole: 'sub',
		yourRole: 'dom',
		control: 'mix'
	};

	test('saves an edit made by the controlling side', async () => {
		const { id } = await createTestPartnership(db, ada, jun, { control: 'me' });
		const result = await runAndCatch(() => run('update', at(id, ada, edit)));
		expect(result).toMatchObject({ type: 'redirect', status: 303, location: '/settings/partners' });

		const row = await readPartnershipRow(db, id);
		expect(row.inviterName).toBe('Ada II');
		expect(row.inviteeName).toBe('Jun II');
		expect(row.inviterRole).toBe('dom');
		expect(row.inviteeRole).toBe('sub');
		expect(row.control).toBe('both');
	});

	test('maps the invitee’s names onto the right columns', async () => {
		// The submitted names are in the viewer's terms; storage is in the
		// inviter/invitee terms, so they swap for the invitee.
		const { id } = await createTestPartnership(db, ada, jun, { control: 'them' });
		const result = await runAndCatch(() => run('update', at(id, jun, { ...edit, control: 'me' })));
		expect(result).toMatchObject({ type: 'redirect', status: 303, location: '/settings/partners' });

		const row = await readPartnershipRow(db, id);
		// Jun's "partnerName" is Ada, who is the inviter.
		expect(row.inviterName).toBe('Jun II');
		expect(row.inviteeName).toBe('Ada II');
		expect(row.control).toBe('invitee');
	});

	test('refuses an edit from the side without control', async () => {
		const { id } = await createTestPartnership(db, ada, jun, {
			control: 'me',
			yourName: 'Ada',
			partnerName: 'Jun'
		});

		const result = await run('update', at(id, jun, edit));
		expect(result.status).toBe(403);
		expect((await readPartnershipRow(db, id)).inviterName).toBe('Ada');
	});

	test('rejects invalid input before touching the row', async () => {
		const { id } = await createTestPartnership(db, ada, jun, {
			control: 'mix',
			yourName: 'Ada'
		});
		const result = await run('update', at(id, ada, { ...edit, yourName: '' }));

		expect(result.status).toBe(400);
		expect((await readPartnershipRow(db, id)).inviterName).toBe('Ada');
	});

	test('404s for a stranger', async () => {
		const { id } = await createTestPartnership(db, ada, jun);
		const result = await runAndCatch(() => run('update', at(id, stranger, edit)));
		expect(result).toMatchObject({ type: 'error', status: 404 });
	});

	test('refuses to run without a session', async () => {
		const { id } = await createTestPartnership(db, ada, jun);
		const result = await runAndCatch(() => run('update', at(id, null, edit)));
		expect(result).toMatchObject({ type: 'error', status: 401 });
	});
});

describe('the rotate action', () => {
	test('returns a fresh link and invalidates the old one', async () => {
		const invite = await createTestInvite(db, ada);
		const result = await run('rotate', at(invite.id, ada));

		expect(result.url).toMatch(/^https:\/\/app\.test\/invite\//);
		expect(result.url).not.toContain(invite.inviteToken);
		expect(await findPendingInviteByToken(db, invite.inviteToken)).toBeNull();
	});

	test('refuses the invitee side of an accepted link', async () => {
		const { id } = await createTestPartnership(db, ada, jun);
		const result = await run('rotate', at(id, jun));
		expect(result.status).toBe(400);
	});

	test('refuses a stranger', async () => {
		const invite = await createTestInvite(db, ada);
		const result = await run('rotate', at(invite.id, stranger));
		expect(result.status).toBe(400);
		// The real inviter's link must survive the attempt.
		expect(await findPendingInviteByToken(db, invite.inviteToken)).not.toBeNull();
	});
});

describe('the disconnect action', () => {
	test('lets the side without control leave', async () => {
		const { id } = await createTestPartnership(db, ada, jun, { control: 'me' });
		const result = await runAndCatch(() => run('disconnect', at(id, jun)));

		expect(result).toMatchObject({ type: 'redirect', status: 303, location: '/settings/partners' });
		expect(await readPartnershipRow(db, id)).toBeUndefined();
	});

	test('lets the inviter cancel a pending invite', async () => {
		const invite = await createTestInvite(db, ada);
		await runAndCatch(() => run('disconnect', at(invite.id, ada)));
		expect(await readPartnershipRow(db, invite.id)).toBeUndefined();
	});

	test('404s for a stranger and leaves the link intact', async () => {
		const { id } = await createTestPartnership(db, ada, jun);
		const result = await runAndCatch(() => run('disconnect', at(id, stranger)));

		expect(result).toMatchObject({ type: 'error', status: 404 });
		expect(await readPartnershipRow(db, id)).toBeDefined();
	});

	test('refuses to run without a session', async () => {
		const { id } = await createTestPartnership(db, ada, jun);
		const result = await runAndCatch(() => run('disconnect', at(id, null)));
		expect(result).toMatchObject({ type: 'error', status: 401 });
	});
});
