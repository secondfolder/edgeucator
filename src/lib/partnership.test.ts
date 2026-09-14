import { describe, expect, test } from 'vitest';
import {
	INVITE_TTL_MS,
	answerFromControl,
	canDisconnect,
	canEditPartnership,
	controlFromAnswer,
	isInviteUsable,
	roleOf,
	viewPartnership,
	type ControlAnswer,
	type PartnershipControl,
	type PartnershipRecord,
	type PartnershipRole
} from './partnership';

const INVITER = 'user-inviter';
const INVITEE = 'user-invitee';
const STRANGER = 'user-stranger';

function record(overrides: Partial<PartnershipRecord> = {}): PartnershipRecord {
	return {
		id: 'p1',
		status: 'accepted',
		inviterId: INVITER,
		inviteeId: INVITEE,
		// Named so a swapped assertion is obvious rather than a coin flip.
		inviterName: 'Name-For-Inviter',
		inviteeName: 'Name-For-Invitee',
		inviterRole: null,
		inviteeRole: null,
		control: 'both',
		...overrides
	};
}

describe('roleOf', () => {
	test('identifies each side', () => {
		expect(roleOf(record(), INVITER)).toBe('inviter');
		expect(roleOf(record(), INVITEE)).toBe('invitee');
	});

	test('returns null for someone who is not a member', () => {
		expect(roleOf(record(), STRANGER)).toBeNull();
	});

	test('returns null for the invitee slot while it is empty', () => {
		// A pending row has inviteeId === null, and null must never match a
		// missing/undefined user id by accident.
		expect(roleOf(record({ status: 'pending', inviteeId: null }), STRANGER)).toBeNull();
	});
});

describe('canEditPartnership', () => {
	test('"both" lets either side edit', () => {
		const r = record({ control: 'both' });
		expect(canEditPartnership(r, INVITER)).toBe(true);
		expect(canEditPartnership(r, INVITEE)).toBe(true);
	});

	test('"inviter" lets only the inviter edit', () => {
		const r = record({ control: 'inviter' });
		expect(canEditPartnership(r, INVITER)).toBe(true);
		expect(canEditPartnership(r, INVITEE)).toBe(false);
	});

	test('"invitee" lets only the invitee edit', () => {
		const r = record({ control: 'invitee' });
		expect(canEditPartnership(r, INVITER)).toBe(false);
		expect(canEditPartnership(r, INVITEE)).toBe(true);
	});

	test('never lets a non-member edit, whatever the control setting', () => {
		for (const control of ['inviter', 'invitee', 'both'] as PartnershipControl[]) {
			expect(canEditPartnership(record({ control }), STRANGER)).toBe(false);
		}
	});
});

describe('canDisconnect', () => {
	test('either member may leave regardless of who holds control', () => {
		for (const control of ['inviter', 'invitee', 'both'] as PartnershipControl[]) {
			const r = record({ control });
			expect(canDisconnect(r, INVITER)).toBe(true);
			expect(canDisconnect(r, INVITEE)).toBe(true);
		}
	});

	test('a non-member may not', () => {
		expect(canDisconnect(record(), STRANGER)).toBe(false);
	});
});

describe('viewPartnership', () => {
	test('the inviter sees the invitee name as their partner', () => {
		const view = viewPartnership(record(), INVITER);
		expect(view.partnerName).toBe('Name-For-Invitee');
		expect(view.yourName).toBe('Name-For-Inviter');
		expect(view.role).toBe('inviter');
	});

	test('the invitee sees the mirror image of the same row', () => {
		const view = viewPartnership(record(), INVITEE);
		expect(view.partnerName).toBe('Name-For-Inviter');
		expect(view.yourName).toBe('Name-For-Invitee');
		expect(view.role).toBe('invitee');
	});

	test('the roles flip with the viewer, like the names', () => {
		const r = record({ inviterRole: 'Role-For-Inviter', inviteeRole: 'Role-For-Invitee' });
		const inviterView = viewPartnership(r, INVITER);
		expect(inviterView.partnerRole).toBe('Role-For-Invitee');
		expect(inviterView.yourRole).toBe('Role-For-Inviter');
		const inviteeView = viewPartnership(r, INVITEE);
		expect(inviteeView.partnerRole).toBe('Role-For-Inviter');
		expect(inviteeView.yourRole).toBe('Role-For-Invitee');
	});

	test('canEdit is carried onto the view', () => {
		expect(viewPartnership(record({ control: 'inviter' }), INVITEE).canEdit).toBe(false);
		expect(viewPartnership(record({ control: 'inviter' }), INVITER).canEdit).toBe(true);
	});

	test('throws rather than returning a half-built view for a stranger', () => {
		expect(() => viewPartnership(record(), STRANGER)).toThrow(/not a member/);
	});

	test('carries the counterpart through untouched', () => {
		const view = viewPartnership(record(), INVITER, {
			userId: INVITEE,
			image: '/a.png',
			timezone: 'UTC'
		});
		expect(view.counterpart).toEqual({ userId: INVITEE, image: '/a.png', timezone: 'UTC' });
	});

	test('id is the partnership id, never a user id', () => {
		expect(viewPartnership(record({ id: 'p-42' }), INVITER).id).toBe('p-42');
	});
});

describe('controlFromAnswer / answerFromControl', () => {
	test('maps the asker’s side onto the stored roles', () => {
		expect(controlFromAnswer('me', 'inviter')).toBe('inviter');
		expect(controlFromAnswer('them', 'inviter')).toBe('invitee');
		expect(controlFromAnswer('me', 'invitee')).toBe('invitee');
		expect(controlFromAnswer('them', 'invitee')).toBe('inviter');
		expect(controlFromAnswer('mix', 'inviter')).toBe('both');
		expect(controlFromAnswer('mix', 'invitee')).toBe('both');
	});

	test('round-trips for every answer and role', () => {
		for (const answer of ['me', 'them', 'mix'] as ControlAnswer[]) {
			for (const role of ['inviter', 'invitee'] as PartnershipRole[]) {
				expect(answerFromControl(controlFromAnswer(answer, role), role)).toBe(answer);
			}
		}
	});

	test('"me" for one side reads as "them" for the other', () => {
		// The regression this guards: storing the answer verbatim would make both
		// members believe they were in control.
		const stored = controlFromAnswer('me', 'inviter');
		expect(answerFromControl(stored, 'inviter')).toBe('me');
		expect(answerFromControl(stored, 'invitee')).toBe('them');
	});
});

describe('isInviteUsable', () => {
	const now = new Date('2026-01-01T00:00:00Z');
	const live = {
		status: 'pending' as const,
		inviteToken: 'tok',
		inviteExpiresAt: new Date(now.getTime() + 1000)
	};

	test('accepts a pending invite inside its window', () => {
		expect(isInviteUsable(live, now)).toBe(true);
	});

	test('rejects one that has expired', () => {
		expect(isInviteUsable({ ...live, inviteExpiresAt: new Date(now.getTime() - 1) }, now)).toBe(
			false
		);
	});

	test('rejects one that expires exactly now', () => {
		expect(isInviteUsable({ ...live, inviteExpiresAt: now }, now)).toBe(false);
	});

	test('rejects an already-accepted partnership', () => {
		expect(isInviteUsable({ ...live, status: 'accepted' }, now)).toBe(false);
	});

	test('rejects a consumed token', () => {
		expect(isInviteUsable({ ...live, inviteToken: null }, now)).toBe(false);
		expect(isInviteUsable({ ...live, inviteExpiresAt: null }, now)).toBe(false);
	});
});

test('INVITE_TTL_MS is seven days', () => {
	expect(INVITE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
});
