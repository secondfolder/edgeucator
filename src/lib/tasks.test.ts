import { describe, expect, test } from 'vitest';
import {
	canCompleteFromPartnership,
	canCompletePartnershipTask,
	canManagePartnershipTasks,
	canViewPartnershipTask,
	isTaskCompletableAt,
	type PartnershipTaskRecord
} from './tasks';
import type { PartnershipRecord } from './partnership';

const INVITER = 'inviter-user';
const INVITEE = 'invitee-user';
const STRANGER = 'stranger-user';

function partnership(overrides: Partial<PartnershipRecord> = {}): PartnershipRecord {
	return {
		id: 'partnership-1',
		status: 'accepted',
		inviterId: INVITER,
		inviteeId: INVITEE,
		inviterName: 'Ada',
		inviteeName: 'Jun',
		inviterRole: null,
		inviteeRole: null,
		control: 'inviter',
		...overrides
	};
}

function task(overrides: Partial<PartnershipTaskRecord> = {}): PartnershipTaskRecord {
	return {
		...partnership(),
		partnershipId: 'partnership-1',
		createdByUserId: INVITER,
		active: true,
		nextEligibleAt: null,
		...overrides
	};
}

describe('canManagePartnershipTasks', () => {
	test('matches the existing control rule', () => {
		expect(canManagePartnershipTasks(partnership({ control: 'both' }), INVITER)).toBe(true);
		expect(canManagePartnershipTasks(partnership({ control: 'both' }), INVITEE)).toBe(true);
		expect(canManagePartnershipTasks(partnership({ control: 'inviter' }), INVITER)).toBe(true);
		expect(canManagePartnershipTasks(partnership({ control: 'inviter' }), INVITEE)).toBe(false);
	});
});

describe('canCompleteFromPartnership', () => {
	test('lets the non-controller complete when control is one-sided', () => {
		expect(canCompleteFromPartnership(partnership({ control: 'inviter' }), INVITEE)).toBe(true);
		expect(canCompleteFromPartnership(partnership({ control: 'inviter' }), INVITER)).toBe(false);
		expect(canCompleteFromPartnership(partnership({ control: 'invitee' }), INVITER)).toBe(true);
		expect(canCompleteFromPartnership(partnership({ control: 'invitee' }), INVITEE)).toBe(false);
	});

	test('lets both members complete under shared control', () => {
		expect(canCompleteFromPartnership(partnership({ control: 'both' }), INVITER)).toBe(true);
		expect(canCompleteFromPartnership(partnership({ control: 'both' }), INVITEE)).toBe(true);
	});

	test('refuses pending links and strangers', () => {
		expect(
			canCompleteFromPartnership(partnership({ status: 'pending', inviteeId: null }), INVITER)
		).toBe(false);
		expect(canCompleteFromPartnership(partnership(), STRANGER)).toBe(false);
	});
});

describe('isTaskCompletableAt', () => {
	const now = new Date('2026-09-14T12:00:00Z');

	test('allows an active task with no next eligibility gate', () => {
		expect(isTaskCompletableAt({ active: true, nextEligibleAt: null }, now)).toBe(true);
	});

	test('blocks inactive tasks and future-gated tasks', () => {
		expect(isTaskCompletableAt({ active: false, nextEligibleAt: null }, now)).toBe(false);
		expect(
			isTaskCompletableAt({ active: true, nextEligibleAt: new Date('2026-09-14T12:01:00Z') }, now)
		).toBe(false);
	});

	test('allows a task exactly when its gate is reached', () => {
		expect(
			isTaskCompletableAt({ active: true, nextEligibleAt: new Date('2026-09-14T12:00:00Z') }, now)
		).toBe(true);
	});
});

describe('canCompletePartnershipTask', () => {
	const now = new Date('2026-09-14T12:00:00Z');

	test('blocks the author even under shared control', () => {
		expect(
			canCompletePartnershipTask(task({ control: 'both', createdByUserId: INVITER }), INVITER, now)
		).toBe(false);
	});

	test('lets the other member complete when control allows it and the task is ready', () => {
		expect(
			canCompletePartnershipTask(
				task({ control: 'both', createdByUserId: INVITEE, nextEligibleAt: now }),
				INVITER,
				now
			)
		).toBe(true);
	});

	test('rejects inactive and not-yet-eligible tasks', () => {
		expect(canCompletePartnershipTask(task({ active: false }), INVITEE, now)).toBe(false);
		expect(
			canCompletePartnershipTask(
				task({ nextEligibleAt: new Date('2026-09-14T12:01:00Z') }),
				INVITEE,
				now
			)
		).toBe(false);
	});
});

describe('canViewPartnershipTask', () => {
	test('shows both sides all tasks under shared control', () => {
		expect(
			canViewPartnershipTask(task({ control: 'both', createdByUserId: INVITER }), INVITER)
		).toBe(true);
		expect(
			canViewPartnershipTask(task({ control: 'both', createdByUserId: INVITER }), INVITEE)
		).toBe(true);
	});

	test('shows only counterpart-authored tasks to the completing side', () => {
		expect(
			canViewPartnershipTask(task({ control: 'inviter', createdByUserId: INVITER }), INVITEE)
		).toBe(true);
		expect(
			canViewPartnershipTask(task({ control: 'inviter', createdByUserId: INVITEE }), INVITEE)
		).toBe(false);
	});

	test('shows only self-authored tasks to the managing side', () => {
		expect(
			canViewPartnershipTask(task({ control: 'inviter', createdByUserId: INVITER }), INVITER)
		).toBe(true);
		expect(
			canViewPartnershipTask(task({ control: 'inviter', createdByUserId: INVITEE }), INVITER)
		).toBe(false);
	});
});
