import { canEditPartnership, roleOf, type PartnershipRecord } from './partnership';
import type { TaskSchedule } from './types';

export type TaskInput = {
	title: string;
	description: string | null;
	active: boolean;
	creditsAwarded: number;
	completionMessages: string[];
	schedule: TaskSchedule;
	timezoneOwnerUserId: string;
};

export type PartnershipTaskRecord = Pick<
	PartnershipRecord,
	'status' | 'control' | 'inviterId' | 'inviteeId'
> & {
	partnershipId: string;
	createdByUserId: string;
	active: boolean;
	nextEligibleAt: Date | null;
};

/** Shared control means both members can manage tasks, matching link edits. */
export function canManagePartnershipTasks(
	record: Pick<PartnershipRecord, 'control' | 'inviterId' | 'inviteeId'>,
	userId: string
): boolean {
	return canEditPartnership(record, userId);
}

/**
 * Whether this member is on the completion side of the current control setting.
 *
 * Sole control splits the feature into manager and completer roles; shared
 * control lets both members complete, subject to authorship and availability.
 */
export function canCompleteFromPartnership(
	record: Pick<PartnershipRecord, 'status' | 'control' | 'inviterId' | 'inviteeId'>,
	userId: string
): boolean {
	const role = roleOf(record, userId);
	if (!role || record.status !== 'accepted') return false;
	return record.control === 'both' || record.control !== role;
}

/**
 * Whether this member should currently see the task on the partnership task page.
 *
 * A control flip can leave old tasks in the database that are now assigned to the
 * wrong side for this viewer. Those tasks stay persisted so they can reappear if
 * control changes again, but the current page only shows tasks that are still on
 * this viewer's present side of the split.
 */
export function canViewPartnershipTask(record: PartnershipTaskRecord, userId: string): boolean {
	const canManage = canManagePartnershipTasks(record, userId);
	const canComplete = canCompleteFromPartnership(record, userId);

	if (!canManage && !canComplete) return false;
	if (canManage && canComplete) return true;
	if (canManage) return record.createdByUserId === userId;
	return record.createdByUserId !== userId;
}

/** One availability check shared by self and partnership tasks. */
export function isTaskCompletableAt(
	record: Pick<PartnershipTaskRecord, 'active' | 'nextEligibleAt'>,
	now: Date = new Date()
): boolean {
	if (!record.active) return false;
	if (!record.nextEligibleAt) return true;
	return record.nextEligibleAt.getTime() <= now.getTime();
}

/**
 * One partnership task completion check.
 *
 * Authorship is independent of control: shared control may let both members
 * complete tasks, but never the one who created that task.
 */
export function canCompletePartnershipTask(
	record: PartnershipTaskRecord,
	viewerId: string,
	now: Date = new Date()
): boolean {
	if (!canCompleteFromPartnership(record, viewerId)) return false;
	if (record.createdByUserId === viewerId) return false;
	return isTaskCompletableAt(record, now);
}
