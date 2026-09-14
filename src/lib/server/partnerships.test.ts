import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { Db } from './db';
import {
	acceptInvite,
	deletePartnership,
	findPendingInviteByToken,
	generateInviteToken,
	getPartnershipForUser,
	listPartnersForNav,
	listPartnershipsForUser,
	partnershipExistsBetween,
	rotateInviteToken,
	updatePartnership
} from './partnerships';
import { INVITE_TTL_MS } from '../partnership';
import { createTestDb, type TestDb } from '../testing/db';
import {
	createTestInvite,
	createTestPartnership,
	createTestUser,
	expireInvite,
	readPartnershipRow,
	type TestUser
} from '../testing/fixtures';

let harness: TestDb;
let db: Db;
let ada: TestUser;
let jun: TestUser;
let stranger: TestUser;

beforeEach(async () => {
	harness = await createTestDb();
	db = harness.db;
	ada = await createTestUser(db, { name: 'Ada', image: '/ada.png' });
	jun = await createTestUser(db, { name: 'Jun' });
	stranger = await createTestUser(db, { name: 'Stranger' });
});

afterEach(() => harness.close());

describe('generateInviteToken', () => {
	test('is URL-safe, so it survives being pasted into a path', () => {
		for (let i = 0; i < 20; i += 1) {
			expect(generateInviteToken()).toMatch(/^[A-Za-z0-9_-]+$/);
		}
	});

	test('does not repeat', () => {
		const tokens = new Set(Array.from({ length: 500 }, () => generateInviteToken()));
		expect(tokens.size).toBe(500);
	});

	test('carries enough entropy to be unguessable', () => {
		// 32 bytes as unpadded base64url.
		expect(generateInviteToken().length).toBeGreaterThanOrEqual(43);
	});
});

describe('createInvite', () => {
	test('stores a pending row with a live token', async () => {
		const now = new Date('2026-03-01T12:00:00Z');
		const invite = await createTestInvite(db, ada, {
			partnerName: 'Jun',
			yourName: 'Ada',
			partnerRole: 'sub',
			yourRole: 'dom',
			control: 'me',
			now
		});

		const row = await readPartnershipRow(db, invite.id);
		expect(row.status).toBe('pending');
		expect(row.inviteeId).toBeNull();
		expect(row.inviterId).toBe(ada.id);
		expect(row.inviterName).toBe('Ada');
		expect(row.inviteeName).toBe('Jun');
		expect(row.inviteeRole).toBe('sub');
		expect(row.inviterRole).toBe('dom');
		// "me", answered by the inviter, is stored as 'inviter'.
		expect(row.control).toBe('inviter');
		expect(row.inviteToken).toBe(invite.inviteToken);
		expect(invite.inviteExpiresAt.getTime()).toBe(now.getTime() + INVITE_TTL_MS);
	});

	test('lets the same inviter have several invites outstanding', async () => {
		const a = await createTestInvite(db, ada);
		const b = await createTestInvite(db, ada);
		expect(a.inviteToken).not.toBe(b.inviteToken);
		expect(await listPartnershipsForUser(db, ada.id)).toHaveLength(2);
	});
});

describe('findPendingInviteByToken', () => {
	test('finds a live invite', async () => {
		const invite = await createTestInvite(db, ada);
		const found = await findPendingInviteByToken(db, invite.inviteToken);
		expect(found?.id).toBe(invite.id);
	});

	test('returns null for an unknown token', async () => {
		expect(await findPendingInviteByToken(db, 'nope')).toBeNull();
	});
});

describe('acceptInvite', () => {
	test('links the two accounts and consumes the token', async () => {
		const invite = await createTestInvite(db, ada);
		const result = await acceptInvite(db, { token: invite.inviteToken, inviteeId: jun.id });

		expect(result).toEqual({ ok: true, id: invite.id });
		const row = await readPartnershipRow(db, invite.id);
		expect(row.status).toBe('accepted');
		expect(row.inviteeId).toBe(jun.id);
		expect(row.acceptedAt).toBeInstanceOf(Date);
		// Cleared so the link cannot be replayed, and so the unique index is
		// free for the same inviter's next invite.
		expect(row.inviteToken).toBeNull();
		expect(row.inviteExpiresAt).toBeNull();
	});

	test('refuses a token that has already been used', async () => {
		const invite = await createTestInvite(db, ada);
		await acceptInvite(db, { token: invite.inviteToken, inviteeId: jun.id });

		const second = await acceptInvite(db, { token: invite.inviteToken, inviteeId: stranger.id });
		expect(second).toEqual({ ok: false, reason: 'not-found' });
	});

	test('only one of two simultaneous accepts wins', async () => {
		const invite = await createTestInvite(db, ada);
		const [first, second] = await Promise.all([
			acceptInvite(db, { token: invite.inviteToken, inviteeId: jun.id }),
			acceptInvite(db, { token: invite.inviteToken, inviteeId: stranger.id })
		]);

		expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
		const row = await readPartnershipRow(db, invite.id);
		expect([jun.id, stranger.id]).toContain(row.inviteeId);
	});

	test('refuses an expired invite', async () => {
		const invite = await createTestInvite(db, ada);
		await expireInvite(db, invite.id);

		expect(await acceptInvite(db, { token: invite.inviteToken, inviteeId: jun.id })).toEqual({
			ok: false,
			reason: 'expired'
		});
	});

	test('refuses an unknown token', async () => {
		expect(await acceptInvite(db, { token: 'nope', inviteeId: jun.id })).toEqual({
			ok: false,
			reason: 'not-found'
		});
	});

	test('refuses the inviter accepting their own link', async () => {
		const invite = await createTestInvite(db, ada);
		expect(await acceptInvite(db, { token: invite.inviteToken, inviteeId: ada.id })).toEqual({
			ok: false,
			reason: 'self'
		});
	});

	test('refuses a second link between the same two people', async () => {
		await createTestPartnership(db, ada, jun);
		const second = await createTestInvite(db, ada);

		expect(await acceptInvite(db, { token: second.inviteToken, inviteeId: jun.id })).toEqual({
			ok: false,
			reason: 'already-linked'
		});
	});

	test('refuses a duplicate even when the roles are reversed', async () => {
		await createTestPartnership(db, ada, jun);
		// Jun now invites Ada. They are already linked, just the other way round.
		const reversed = await createTestInvite(db, jun);

		expect(await acceptInvite(db, { token: reversed.inviteToken, inviteeId: ada.id })).toEqual({
			ok: false,
			reason: 'already-linked'
		});
	});

	describe('the names the accepter submits', () => {
		test('are honoured when control is shared', async () => {
			const invite = await createTestInvite(db, ada, { control: 'mix' });
			await acceptInvite(db, {
				token: invite.inviteToken,
				inviteeId: jun.id,
				inviterName: 'Renamed Ada',
				inviteeName: 'Renamed Jun',
				inviterRole: 'trainer',
				inviteeRole: 'trainee'
			});

			const row = await readPartnershipRow(db, invite.id);
			expect(row.inviterName).toBe('Renamed Ada');
			expect(row.inviteeName).toBe('Renamed Jun');
			expect(row.inviterRole).toBe('trainer');
			expect(row.inviteeRole).toBe('trainee');
		});

		test('are honoured when the accepter holds control', async () => {
			// "them", answered by the inviter, means the invitee is in control.
			const invite = await createTestInvite(db, ada, { control: 'them' });
			await acceptInvite(db, {
				token: invite.inviteToken,
				inviteeId: jun.id,
				inviterName: 'Renamed Ada'
			});

			expect((await readPartnershipRow(db, invite.id)).inviterName).toBe('Renamed Ada');
		});

		test('are ignored when the inviter holds control', async () => {
			const invite = await createTestInvite(db, ada, {
				yourName: 'Ada',
				partnerName: 'Jun',
				control: 'me'
			});
			await acceptInvite(db, {
				token: invite.inviteToken,
				inviteeId: jun.id,
				inviterName: 'Hijacked',
				inviteeName: 'Hijacked',
				inviterRole: 'hijacked',
				inviteeRole: 'hijacked',
				control: 'invitee'
			});

			const row = await readPartnershipRow(db, invite.id);
			expect(row.inviterName).toBe('Ada');
			expect(row.inviteeName).toBe('Jun');
			expect(row.inviterRole).toBeNull();
			expect(row.inviteeRole).toBeNull();
			// The control setting itself is the most important thing not to hand
			// over: accepting must not be a way to seize it.
			expect(row.control).toBe('inviter');
			// ...but the link is still made.
			expect(row.status).toBe('accepted');
		});
	});
});

describe('rotateInviteToken', () => {
	test('issues a new token and kills the old one', async () => {
		const invite = await createTestInvite(db, ada);
		const rotated = await rotateInviteToken(db, invite.id, ada.id);

		expect(rotated?.inviteToken).toBeTruthy();
		expect(rotated?.inviteToken).not.toBe(invite.inviteToken);
		expect(await findPendingInviteByToken(db, invite.inviteToken)).toBeNull();
		expect((await findPendingInviteByToken(db, rotated!.inviteToken))?.id).toBe(invite.id);
	});

	test('extends the expiry window', async () => {
		const created = new Date('2026-03-01T00:00:00Z');
		const invite = await createTestInvite(db, ada, { now: created });
		const later = new Date('2026-03-05T00:00:00Z');

		const rotated = await rotateInviteToken(db, invite.id, ada.id, later);
		expect(rotated?.inviteExpiresAt.getTime()).toBe(later.getTime() + INVITE_TTL_MS);
	});

	test('refuses anyone who is not the inviter', async () => {
		const invite = await createTestInvite(db, ada);
		expect(await rotateInviteToken(db, invite.id, stranger.id)).toBeNull();
		// The original link must survive a rejected rotation.
		expect(await findPendingInviteByToken(db, invite.inviteToken)).not.toBeNull();
	});

	test('refuses an already-accepted partnership', async () => {
		const { id } = await createTestPartnership(db, ada, jun);
		expect(await rotateInviteToken(db, id, ada.id)).toBeNull();
	});
});

describe('listPartnersForNav', () => {
	test('shows each side the name they chose for the other', async () => {
		await createTestPartnership(db, ada, jun, { yourName: 'Ada', partnerName: 'Jun' });

		expect(await listPartnersForNav(db, ada.id)).toEqual([
			{ id: expect.any(String), name: 'Jun', image: null }
		]);
		expect(await listPartnersForNav(db, jun.id)).toEqual([
			{ id: expect.any(String), name: 'Ada', image: '/ada.png' }
		]);
	});

	test('leaves pending invites out of the nav', async () => {
		await createTestInvite(db, ada);
		expect(await listPartnersForNav(db, ada.id)).toEqual([]);
	});

	test('shows nothing to someone in no partnerships', async () => {
		await createTestPartnership(db, ada, jun);
		expect(await listPartnersForNav(db, stranger.id)).toEqual([]);
	});

	test('lists several partners in a stable order', async () => {
		const kit = await createTestUser(db, { name: 'Kit' });
		await createTestPartnership(db, ada, jun, { partnerName: 'Jun' });
		await createTestPartnership(db, kit, ada, { yourName: 'Kit', partnerName: 'Ada' });

		const first = await listPartnersForNav(db, ada.id);
		const second = await listPartnersForNav(db, ada.id);
		expect(first.map((p) => p.name).sort()).toEqual(['Jun', 'Kit']);
		expect(second).toEqual(first);
	});

	test('keys tabs on the partnership id, not the partner’s user id', async () => {
		const { id } = await createTestPartnership(db, ada, jun);
		const [tab] = await listPartnersForNav(db, ada.id);
		expect(tab.id).toBe(id);
		expect(tab.id).not.toBe(jun.id);
	});
});

describe('listPartnershipsForUser', () => {
	test('includes both pending and accepted', async () => {
		await createTestPartnership(db, ada, jun, { partnerName: 'Jun' });
		await createTestInvite(db, ada, { partnerName: 'Nobody yet' });

		const all = await listPartnershipsForUser(db, ada.id);
		expect(all.map((p) => p.status).sort()).toEqual(['accepted', 'pending']);
		expect(all.find((p) => p.status === 'pending')?.partnerName).toBe('Nobody yet');
	});

	test('shows the invitee their side of the row', async () => {
		await createTestPartnership(db, ada, jun, { yourName: 'Ada', partnerName: 'Jun' });
		const [view] = await listPartnershipsForUser(db, jun.id);
		expect(view.role).toBe('invitee');
		expect(view.partnerName).toBe('Ada');
		expect(view.yourName).toBe('Jun');
	});
});

describe('getPartnershipForUser', () => {
	test('returns the row to a member', async () => {
		const { id } = await createTestPartnership(db, ada, jun);
		expect((await getPartnershipForUser(db, id, ada.id))?.id).toBe(id);
		expect((await getPartnershipForUser(db, id, jun.id))?.id).toBe(id);
	});

	test('returns null to anyone else', async () => {
		const { id } = await createTestPartnership(db, ada, jun);
		expect(await getPartnershipForUser(db, id, stranger.id)).toBeNull();
	});

	test('returns null for an id that does not exist', async () => {
		expect(await getPartnershipForUser(db, 'made-up', ada.id)).toBeNull();
	});

	test('gives a pending invite back to its inviter, token and all', async () => {
		const invite = await createTestInvite(db, ada);
		const view = await getPartnershipForUser(db, invite.id, ada.id);
		expect(view?.status).toBe('pending');
		expect(view?.inviteToken).toBe(invite.inviteToken);
		expect(view?.counterpart).toBeNull();
	});
});

describe('updatePartnership', () => {
	test('applies an edit from the side that holds control', async () => {
		const { id } = await createTestPartnership(db, ada, jun, { control: 'me' });
		const ok = await updatePartnership(db, id, ada.id, {
			inviterName: 'Ada II',
			inviteeName: 'Jun II',
			inviterRole: 'dom',
			inviteeRole: 'sub',
			control: 'both'
		});

		expect(ok).toBe(true);
		const row = await readPartnershipRow(db, id);
		expect(row.inviterName).toBe('Ada II');
		expect(row.inviterRole).toBe('dom');
		expect(row.control).toBe('both');
	});

	test('refuses the side that does not', async () => {
		const { id } = await createTestPartnership(db, ada, jun, {
			control: 'me',
			yourName: 'Ada',
			partnerName: 'Jun'
		});
		const ok = await updatePartnership(db, id, jun.id, {
			inviterName: 'Hijacked',
			inviteeName: 'Hijacked',
			inviterRole: null,
			inviteeRole: null,
			control: 'invitee'
		});

		expect(ok).toBe(false);
		expect((await readPartnershipRow(db, id)).inviterName).toBe('Ada');
	});

	test('lets either side edit when control is shared', async () => {
		const { id } = await createTestPartnership(db, ada, jun, { control: 'mix' });
		const edit = {
			inviterName: 'A',
			inviteeName: 'J',
			inviterRole: null,
			inviteeRole: null,
			control: 'both' as const
		};
		expect(await updatePartnership(db, id, ada.id, edit)).toBe(true);
		expect(await updatePartnership(db, id, jun.id, edit)).toBe(true);
	});

	test('refuses a non-member outright', async () => {
		const { id } = await createTestPartnership(db, ada, jun, { control: 'mix' });
		const ok = await updatePartnership(db, id, stranger.id, {
			inviterName: 'x',
			inviteeName: 'y',
			inviterRole: null,
			inviteeRole: null,
			control: 'both'
		});
		expect(ok).toBe(false);
	});

	test('handing control away takes it away immediately', async () => {
		const { id } = await createTestPartnership(db, ada, jun, { control: 'me' });
		await updatePartnership(db, id, ada.id, {
			inviterName: 'Ada',
			inviteeName: 'Jun',
			inviterRole: null,
			inviteeRole: null,
			control: 'invitee'
		});

		// Ada gave control to Jun, so her next edit must be refused.
		const second = await updatePartnership(db, id, ada.id, {
			inviterName: 'Take it back',
			inviteeName: 'Jun',
			inviterRole: null,
			inviteeRole: null,
			control: 'inviter'
		});
		expect(second).toBe(false);
		expect((await readPartnershipRow(db, id)).inviterName).toBe('Ada');
	});
});

describe('deletePartnership', () => {
	test('lets the side without control leave anyway', async () => {
		// The rule this protects: control gates editing, never leaving.
		const { id } = await createTestPartnership(db, ada, jun, { control: 'me' });
		expect(await deletePartnership(db, id, jun.id)).toBe(true);
		expect(await readPartnershipRow(db, id)).toBeUndefined();
	});

	test('lets the inviter cancel a pending invite', async () => {
		const invite = await createTestInvite(db, ada);
		expect(await deletePartnership(db, invite.id, ada.id)).toBe(true);
		expect(await findPendingInviteByToken(db, invite.inviteToken)).toBeNull();
	});

	test('refuses a non-member', async () => {
		const { id } = await createTestPartnership(db, ada, jun);
		expect(await deletePartnership(db, id, stranger.id)).toBe(false);
		expect(await readPartnershipRow(db, id)).toBeDefined();
	});

	test('removes the partner from both navs', async () => {
		const { id } = await createTestPartnership(db, ada, jun);
		await deletePartnership(db, id, ada.id);
		expect(await listPartnersForNav(db, ada.id)).toEqual([]);
		expect(await listPartnersForNav(db, jun.id)).toEqual([]);
	});

	test('frees the pair to link again afterwards', async () => {
		const { id } = await createTestPartnership(db, ada, jun);
		await deletePartnership(db, id, ada.id);

		const again = await createTestInvite(db, ada);
		expect(await acceptInvite(db, { token: again.inviteToken, inviteeId: jun.id })).toMatchObject({
			ok: true
		});
	});
});

describe('partnershipExistsBetween', () => {
	test('is true in both directions once linked', async () => {
		await createTestPartnership(db, ada, jun);
		expect(await partnershipExistsBetween(db, ada.id, jun.id)).toBe(true);
		expect(await partnershipExistsBetween(db, jun.id, ada.id)).toBe(true);
	});

	test('is false while the invite is only pending', async () => {
		await createTestInvite(db, ada);
		expect(await partnershipExistsBetween(db, ada.id, jun.id)).toBe(false);
	});
});

describe('cascade behaviour', () => {
	test('deleting a user takes their partnerships with them', async () => {
		const { id } = await createTestPartnership(db, ada, jun);
		const { user } = await import('./db/schema');
		const { eq } = await import('drizzle-orm');
		await db.delete(user).where(eq(user.id, jun.id));

		// Otherwise Ada would keep a nav tab pointing at a deleted account.
		expect(await readPartnershipRow(db, id)).toBeUndefined();
	});
});
