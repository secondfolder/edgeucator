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
import { listPartnersForNav } from '$lib/server/partnerships';

let harness: TestDb;
let db: Db;
let ada: TestUser;
let jun: TestUser;

beforeEach(async () => {
	harness = await createTestDb();
	db = harness.db;
	ada = await createTestUser(db, { name: 'Ada' });
	jun = await createTestUser(db, { name: 'Jun' });
});

afterEach(() => harness.close());

const at = (token: string, user: TestUser | null, formData?: Record<string, string>) =>
	fakeEvent({ db, user, params: { token }, formData, path: `/invite/${token}` });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const accept = (event: unknown) => (actions.default as any)(event);

describe('load', () => {
	test('asks an anonymous visitor to sign in, and remembers where to come back to', async () => {
		const invite = await createTestInvite(db, ada, { yourName: 'Ada' });
		const data = await runLoad(load(at(invite.inviteToken, null)));

		expect(data.state).toBe('sign-in-required');
		expect(data.inviterName).toBe('Ada');
		expect(data.redirectTo).toBe(`/invite/${invite.inviteToken}`);
	});

	test('shows an anonymous visitor nothing but the name the inviter chose', async () => {
		// Not the inviter's account name, not their email — this page is
		// reachable by anyone holding the link.
		const invite = await createTestInvite(db, ada, { yourName: 'Sir' });
		const data = await runLoad(load(at(invite.inviteToken, null)));

		const serialised = JSON.stringify(data);
		expect(serialised).toContain('Sir');
		expect(serialised).not.toContain(ada.email);
		expect(serialised).not.toContain(ada.id);
	});

	test('reports an unknown token as simply invalid', async () => {
		const data = await runLoad(load(at('made-up', null)));
		expect(data.state).toBe('invalid');
		expect(data.inviterName).toBeNull();
	});

	test('reports an expired token the same way, giving nothing away', async () => {
		const invite = await createTestInvite(db, ada, { yourName: 'Ada' });
		await expireInvite(db, invite.id);

		const data = await runLoad(load(at(invite.inviteToken, null)));
		expect(data.state).toBe('invalid');
		expect(data.inviterName).toBeNull();
	});

	test('reports a consumed token as invalid', async () => {
		const invite = await createTestInvite(db, ada);
		await runAndCatch(() => accept(at(invite.inviteToken, jun, confirmation)));

		const data = await runLoad(load(at(invite.inviteToken, null)));
		expect(data.state).toBe('invalid');
	});

	test('tells the inviter it is their own link', async () => {
		const invite = await createTestInvite(db, ada);
		expect((await runLoad(load(at(invite.inviteToken, ada)))).state).toBe('self');
	});

	test('tells an already-linked partner so', async () => {
		await createTestPartnership(db, ada, jun);
		const second = await createTestInvite(db, ada);
		expect((await runLoad(load(at(second.inviteToken, jun)))).state).toBe('already-linked');
	});

	describe('the confirmation screen', () => {
		test('is editable when the accepter is in control', async () => {
			// "them", answered by the inviter, means the invitee is in control.
			const invite = await createTestInvite(db, ada, { control: 'them' });
			const data = await runLoad(load(at(invite.inviteToken, jun)));

			expect(data.state).toBe('confirm');
			expect(data.editable).toBe(true);
		});

		test('is editable when control is shared', async () => {
			const invite = await createTestInvite(db, ada, { control: 'mix' });
			expect((await runLoad(load(at(invite.inviteToken, jun)))).editable).toBe(true);
		});

		test('is read-only when the inviter keeps control', async () => {
			const invite = await createTestInvite(db, ada, { control: 'me' });
			expect((await runLoad(load(at(invite.inviteToken, jun)))).editable).toBe(false);
		});

		test('prefills the names from the accepter’s side', async () => {
			const invite = await createTestInvite(db, ada, {
				yourName: 'Ada',
				partnerName: 'Jun',
				partnerRole: 'dom',
				yourRole: 'sub',
				control: 'mix'
			});
			const data = await runLoad(load(at(invite.inviteToken, jun)));

			expect(data.partnerAcceptForm?.data).toMatchObject({
				// From Jun's side, "them" is Ada — and the roles flip with them.
				partnerName: 'Ada',
				yourName: 'Jun',
				partnerRole: 'sub',
				yourRole: 'dom',
				control: 'mix'
			});
		});

		test('shows the inviter’s "me" as the accepter’s "them"', async () => {
			const invite = await createTestInvite(db, ada, { control: 'me' });
			const data = await runLoad(load(at(invite.inviteToken, jun)));
			expect(data.partnerAcceptForm?.data.control).toBe('them');
		});
	});
});

const confirmation = {
	partnerName: 'Ada',
	yourName: 'Jun',
	partnerRole: '',
	yourRole: '',
	control: 'them'
};

describe('the accept action', () => {
	test('links the accounts and lands on the new partner page', async () => {
		const invite = await createTestInvite(db, ada, { control: 'mix' });
		const result = await runAndCatch(() => accept(at(invite.inviteToken, jun, confirmation)));

		expect(result).toMatchObject({
			type: 'redirect',
			status: 303,
			location: `/partner/${invite.id}`
		});
		expect((await readPartnershipRow(db, invite.id)).status).toBe('accepted');
	});

	test('puts each partner in the other’s nav', async () => {
		const invite = await createTestInvite(db, ada, { control: 'mix' });
		await runAndCatch(() => accept(at(invite.inviteToken, jun, confirmation)));

		expect(await listPartnersForNav(db, ada.id)).toEqual([
			{ id: invite.id, name: 'Jun', image: null }
		]);
		expect(await listPartnersForNav(db, jun.id)).toEqual([
			{ id: invite.id, name: 'Ada', image: null }
		]);
	});

	test('writes the accepter’s edits onto the right columns', async () => {
		const invite = await createTestInvite(db, ada, { control: 'mix' });
		await runAndCatch(() =>
			accept(
				at(invite.inviteToken, jun, {
					partnerName: 'Ada the First',
					yourName: 'Junior',
					partnerRole: 'dom',
					yourRole: 'sub',
					control: 'me'
				})
			)
		);

		const row = await readPartnershipRow(db, invite.id);
		// The accepter is the invitee, so their "partnerName" is the inviter's.
		expect(row.inviterName).toBe('Ada the First');
		expect(row.inviteeName).toBe('Junior');
		expect(row.inviterRole).toBe('dom');
		expect(row.inviteeRole).toBe('sub');
		expect(row.control).toBe('invitee');
	});

	test('ignores edits from an accepter who does not hold control', async () => {
		// The read-only screen sends the values back as hidden inputs, so the
		// server has to be the thing that refuses them — not the disabled attr.
		const invite = await createTestInvite(db, ada, {
			control: 'me',
			yourName: 'Ada',
			partnerName: 'Jun'
		});
		await runAndCatch(() =>
			accept(
				at(invite.inviteToken, jun, {
					partnerName: 'Hijacked',
					yourName: 'Hijacked',
					partnerRole: 'hijacked',
					yourRole: 'hijacked',
					control: 'me'
				})
			)
		);

		const row = await readPartnershipRow(db, invite.id);
		expect(row.inviterName).toBe('Ada');
		expect(row.inviteeName).toBe('Jun');
		expect(row.inviterRole).toBeNull();
		expect(row.inviteeRole).toBeNull();
		expect(row.control).toBe('inviter');
		expect(row.status).toBe('accepted');
	});

	test('refuses an anonymous accept', async () => {
		const invite = await createTestInvite(db, ada);
		const result = await runAndCatch(() => accept(at(invite.inviteToken, null, confirmation)));
		expect(result).toMatchObject({ type: 'error', status: 401 });
		expect((await readPartnershipRow(db, invite.id)).status).toBe('pending');
	});

	test('refuses the inviter accepting their own invite', async () => {
		const invite = await createTestInvite(db, ada);
		const result = await accept(at(invite.inviteToken, ada, confirmation));

		expect(result.status).toBe(400);
		expect(result.data.form.errors._errors).toEqual(['This is your own invite link.']);
		expect((await readPartnershipRow(db, invite.id)).status).toBe('pending');
	});

	test('reports an expired invite with something the user can act on', async () => {
		const invite = await createTestInvite(db, ada);
		await expireInvite(db, invite.id);

		const result = await accept(at(invite.inviteToken, jun, confirmation));
		expect(result.status).toBe(400);
		expect(result.data.form.errors._errors[0]).toMatch(/expired/i);
	});

	test('reports an unknown token as a 404', async () => {
		const result = await accept(at('made-up', jun, confirmation));
		expect(result.status).toBe(404);
	});

	test('refuses a second link between the same pair', async () => {
		await createTestPartnership(db, ada, jun);
		const second = await createTestInvite(db, ada);

		const result = await accept(at(second.inviteToken, jun, confirmation));
		expect(result.status).toBe(400);
		expect(result.data.form.errors._errors[0]).toMatch(/already linked/i);
	});

	test('rejects invalid input without consuming the invite', async () => {
		const invite = await createTestInvite(db, ada, { control: 'mix' });
		const result = await accept(at(invite.inviteToken, jun, { ...confirmation, yourName: '' }));

		expect(result.status).toBe(400);
		expect((await readPartnershipRow(db, invite.id)).status).toBe('pending');
	});

	test('a second accept of the same link fails', async () => {
		const invite = await createTestInvite(db, ada);
		const other = await createTestUser(db, { name: 'Kit' });
		await runAndCatch(() => accept(at(invite.inviteToken, jun, confirmation)));

		const result = await accept(at(invite.inviteToken, other, confirmation));
		expect(result.status).toBe(404);
		expect((await readPartnershipRow(db, invite.id)).inviteeId).toBe(jun.id);
	});
});
