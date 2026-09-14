import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from './db';
import {
	partnershipRewardCredits,
	partnershipTaskCompletions,
	partnershipTasks,
	partnerships,
	selfRewardCredits,
	selfTaskCompletions,
	selfTasks
} from './db/schema';
import { getPartnershipForUser } from './partnerships';
import { canViewPartnershipTask, isTaskCompletableAt, type TaskInput } from '../tasks';
import {
	initialNextEligibleAt,
	nextEligibleAtAfterCompletion,
	scheduleReferenceDate
} from '../task-schedule';
import type {
	HomePartnerTasksSectionView,
	PartnershipTaskCompletionView,
	PartnershipTaskView,
	PartnerView,
	SelfTasksSectionView,
	SelfTaskView,
	TaskCompletionView,
	TaskSchedule,
	TaskTimeZoneNoteView
} from '../types';

const selfTaskColumns = {
	id: selfTasks.id,
	ownerId: selfTasks.ownerId,
	title: selfTasks.title,
	description: selfTasks.description,
	active: selfTasks.active,
	creditsAwarded: selfTasks.creditsAwarded,
	completionMessages: selfTasks.completionMessages,
	schedule: selfTasks.schedule,
	timezoneOwnerUserId: selfTasks.timezoneOwnerUserId,
	lastCompletedAt: selfTasks.lastCompletedAt,
	completedCount: selfTasks.completedCount,
	nextEligibleAt: selfTasks.nextEligibleAt,
	createdAt: selfTasks.createdAt,
	updatedAt: selfTasks.updatedAt
} as const;

const partnershipTaskColumns = {
	id: partnershipTasks.id,
	partnershipId: partnershipTasks.partnershipId,
	createdByUserId: partnershipTasks.createdByUserId,
	timezoneOwnerUserId: partnershipTasks.timezoneOwnerUserId,
	title: partnershipTasks.title,
	description: partnershipTasks.description,
	active: partnershipTasks.active,
	creditsAwarded: partnershipTasks.creditsAwarded,
	completionMessages: partnershipTasks.completionMessages,
	schedule: partnershipTasks.schedule,
	lastCompletedAt: partnershipTasks.lastCompletedAt,
	completedCount: partnershipTasks.completedCount,
	nextEligibleAt: partnershipTasks.nextEligibleAt,
	createdAt: partnershipTasks.createdAt,
	updatedAt: partnershipTasks.updatedAt
} as const;

const selfTaskCompletionColumns = {
	id: selfTaskCompletions.id,
	taskTitle: selfTaskCompletions.taskTitle,
	taskDescription: selfTaskCompletions.taskDescription,
	creditsAwarded: selfTaskCompletions.creditsAwarded,
	completionMessage: selfTaskCompletions.completionMessage,
	createdAt: selfTaskCompletions.createdAt
} as const;

const partnershipTaskCompletionColumns = {
	id: partnershipTaskCompletions.id,
	completedByUserId: partnershipTaskCompletions.completedByUserId,
	createdByUserId: partnershipTaskCompletions.createdByUserId,
	taskTitle: partnershipTaskCompletions.taskTitle,
	taskDescription: partnershipTaskCompletions.taskDescription,
	creditsAwarded: partnershipTaskCompletions.creditsAwarded,
	completionMessage: partnershipTaskCompletions.completionMessage,
	createdAt: partnershipTaskCompletions.createdAt
} as const;

type SelfTaskRow = {
	id: string;
	ownerId: string;
	title: string;
	description: string | null;
	active: boolean;
	creditsAwarded: number;
	completionMessages: string[];
	schedule: TaskSchedule;
	timezoneOwnerUserId: string;
	lastCompletedAt: Date | null;
	completedCount: number;
	nextEligibleAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
};

type PartnershipTaskRow = {
	id: string;
	partnershipId: string;
	createdByUserId: string;
	timezoneOwnerUserId: string;
	title: string;
	description: string | null;
	active: boolean;
	creditsAwarded: number;
	completionMessages: string[];
	schedule: TaskSchedule;
	lastCompletedAt: Date | null;
	completedCount: number;
	nextEligibleAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
};

type SelfTaskCompletionRow = TaskCompletionView;

type PartnershipTaskCompletionRow = TaskCompletionView & {
	completedByUserId: string;
	createdByUserId: string;
};

type TaskMembership = {
	partnership: NonNullable<Awaited<ReturnType<typeof getPartnershipForUser>>>;
	viewerId: string;
	viewerTimezone: string;
	canManage: boolean;
	canComplete: boolean;
	counterpartUserId: string;
	counterpartTimezone: string;
};

export type PartnershipTasksPageView = {
	partner: {
		id: string;
		name: string;
		canManageTasks: boolean;
		canCompleteTasks: boolean;
		counterpartUserId: string;
		counterpartTimezone: string;
	};
	tasks: PartnershipTaskView[];
	completions: PartnershipTaskCompletionView[];
};

type TaskResult<TReason extends string> = { ok: true } | { ok: false; reason: TReason };
type CreateTaskResult<TReason extends string> =
	{ ok: true; id: string } | { ok: false; reason: TReason };

function canCompleteFromPartnershipView(partnership: TaskMembership['partnership']): boolean {
	return partnership.control === 'both' || !partnership.canEdit;
}

function taskReferenceDate(
	schedule: TaskSchedule,
	row: Pick<SelfTaskRow, 'createdAt' | 'lastCompletedAt' | 'nextEligibleAt'>
): Date | null {
	if (row.nextEligibleAt) return row.nextEligibleAt;
	if (row.lastCompletedAt) return row.lastCompletedAt;
	if (schedule.mode !== 'scheduled' && schedule.mode !== 'one-off') return row.createdAt;
	return null;
}

function toTimeZoneNote(
	timeZone: string | null,
	referenceTimeZone: string,
	date: Date | null,
	showCurrentTime = false
): TaskTimeZoneNoteView | null {
	if (!timeZone || timeZone === referenceTimeZone || !date) return null;
	return { timeZone, referenceTimeZone, date, showCurrentTime };
}

function toTaskCompletionView(row: SelfTaskCompletionRow): TaskCompletionView {
	return {
		id: row.id,
		taskTitle: row.taskTitle,
		taskDescription: row.taskDescription,
		creditsAwarded: row.creditsAwarded,
		completionMessage: row.completionMessage,
		createdAt: row.createdAt
	};
}

function resolveTimeZoneForSelfTask(
	row: Pick<SelfTaskRow, 'timezoneOwnerUserId'>,
	viewerId: string,
	viewerTimezone: string
): string | null {
	return row.timezoneOwnerUserId === viewerId ? viewerTimezone : null;
}

function resolveTimeZoneForPartnershipTask(
	row: Pick<PartnershipTaskRow, 'timezoneOwnerUserId'>,
	membership: TaskMembership
): string | null {
	if (row.timezoneOwnerUserId === membership.viewerId) return membership.viewerTimezone;
	if (row.timezoneOwnerUserId === membership.counterpartUserId)
		return membership.counterpartTimezone;
	return null;
}

function toSelfTaskView(row: SelfTaskRow, viewerTimezone: string): SelfTaskView {
	const noteDate =
		taskReferenceDate(row.schedule, row) ??
		(row.schedule.mode === 'one-off' ? null : scheduleReferenceDate(row.schedule, viewerTimezone));
	return {
		id: row.id,
		title: row.title,
		description: row.description,
		active: row.active,
		creditsAwarded: row.creditsAwarded,
		completionMessages: row.completionMessages,
		schedule: row.schedule,
		timezoneOwnerUserId: row.timezoneOwnerUserId,
		lastCompletedAt: row.lastCompletedAt,
		completedCount: row.completedCount,
		nextEligibleAt: row.nextEligibleAt,
		canComplete: isTaskCompletableAt(row),
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		timeZoneNote: toTimeZoneNote(
			resolveTimeZoneForSelfTask(row, row.ownerId, viewerTimezone),
			viewerTimezone,
			noteDate
		)
	};
}

function toPartnershipTaskView(
	row: PartnershipTaskRow,
	membership: TaskMembership
): PartnershipTaskView {
	const ownerTimeZone =
		resolveTimeZoneForPartnershipTask(row, membership) ?? membership.viewerTimezone;
	const noteDate =
		taskReferenceDate(row.schedule, row) ??
		(row.schedule.mode === 'one-off' ? null : scheduleReferenceDate(row.schedule, ownerTimeZone));
	const createdByMe = row.createdByUserId === membership.viewerId;
	return {
		id: row.id,
		title: row.title,
		description: row.description,
		active: row.active,
		creditsAwarded: row.creditsAwarded,
		completionMessages: row.completionMessages,
		schedule: row.schedule,
		timezoneOwnerUserId: row.timezoneOwnerUserId,
		lastCompletedAt: row.lastCompletedAt,
		completedCount: row.completedCount,
		nextEligibleAt: row.nextEligibleAt,
		createdByMe,
		canManage: membership.canManage,
		canComplete: membership.canComplete && !createdByMe && isTaskCompletableAt(row),
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		timeZoneNote: toTimeZoneNote(
			resolveTimeZoneForPartnershipTask(row, membership),
			membership.viewerTimezone,
			noteDate
		)
	};
}

async function readSelfRewardCredits(db: Db, userId: string): Promise<number> {
	const rows = await db
		.select({ credits: selfRewardCredits.credits })
		.from(selfRewardCredits)
		.where(eq(selfRewardCredits.ownerId, userId))
		.limit(1);
	return rows[0]?.credits ?? 0;
}

async function readPartnershipRewardCredits(
	db: Db,
	partnershipId: string,
	userId: string
): Promise<number> {
	const rows = await db
		.select({ credits: partnershipRewardCredits.credits })
		.from(partnershipRewardCredits)
		.where(
			and(
				eq(partnershipRewardCredits.partnershipId, partnershipId),
				eq(partnershipRewardCredits.userId, userId)
			)
		)
		.limit(1);
	return rows[0]?.credits ?? 0;
}

async function recentSelfTaskCompletionTimes(
	db: Db,
	taskId: string,
	limit: number
): Promise<Date[]> {
	if (limit <= 0) return [];
	const rows = await db
		.select({ createdAt: selfTaskCompletions.createdAt })
		.from(selfTaskCompletions)
		.where(eq(selfTaskCompletions.taskId, taskId))
		.orderBy(desc(selfTaskCompletions.createdAt), desc(selfTaskCompletions.id))
		.limit(limit);
	return rows.map((row) => row.createdAt);
}

async function recentPartnershipTaskCompletionTimes(
	db: Db,
	taskId: string,
	limit: number
): Promise<Date[]> {
	if (limit <= 0) return [];
	const rows = await db
		.select({ createdAt: partnershipTaskCompletions.createdAt })
		.from(partnershipTaskCompletions)
		.where(eq(partnershipTaskCompletions.taskId, taskId))
		.orderBy(desc(partnershipTaskCompletions.createdAt), desc(partnershipTaskCompletions.id))
		.limit(limit);
	return rows.map((row) => row.createdAt);
}

function chooseCompletionMessage(messages: string[]): string | null {
	if (messages.length === 0) return null;
	const index = Math.floor(Math.random() * messages.length);
	return messages[index] ?? null;
}

function toPartnershipTaskCompletionView(
	row: PartnershipTaskCompletionRow,
	viewerId: string
): PartnershipTaskCompletionView {
	return {
		id: row.id,
		taskTitle: row.taskTitle,
		taskDescription: row.taskDescription,
		creditsAwarded: row.creditsAwarded,
		completionMessage: row.completionMessage,
		createdAt: row.createdAt,
		mine: row.completedByUserId === viewerId,
		createdByMe: row.createdByUserId === viewerId
	};
}

export async function requireTaskMembership(
	db: Db,
	partnershipId: string,
	userId: string,
	viewerTimezone: string
): Promise<TaskMembership | null> {
	const partnership = await getPartnershipForUser(db, partnershipId, userId);
	if (!partnership || partnership.status !== 'accepted' || !partnership.counterpart?.userId)
		return null;
	return {
		partnership,
		viewerId: userId,
		viewerTimezone,
		canManage: partnership.canEdit,
		canComplete: canCompleteFromPartnershipView(partnership),
		counterpartUserId: partnership.counterpart.userId,
		counterpartTimezone: partnership.counterpart.timezone
	};
}

export async function getSelfTasksSection(
	db: Db,
	userId: string,
	viewerTimezone: string
): Promise<SelfTasksSectionView> {
	const [tasks, completions] = await Promise.all([
		db
			.select(selfTaskColumns)
			.from(selfTasks)
			.where(eq(selfTasks.ownerId, userId))
			.orderBy(desc(selfTasks.active), desc(selfTasks.createdAt), asc(selfTasks.id)),
		db
			.select(selfTaskCompletionColumns)
			.from(selfTaskCompletions)
			.where(eq(selfTaskCompletions.ownerId, userId))
			.orderBy(desc(selfTaskCompletions.createdAt), desc(selfTaskCompletions.id))
	]);

	return {
		tasks: tasks.map((row) => toSelfTaskView(row, viewerTimezone)),
		completions: completions.map(toTaskCompletionView)
	};
}

export async function createSelfTask(
	db: Db,
	userId: string,
	ownerTimeZone: string,
	input: TaskInput
): Promise<string> {
	const now = new Date();
	const [row] = await db
		.insert(selfTasks)
		.values({
			ownerId: userId,
			title: input.title,
			description: input.description,
			active: input.active,
			creditsAwarded: input.creditsAwarded,
			completionMessages: input.completionMessages,
			schedule: input.schedule,
			timezoneOwnerUserId: userId,
			nextEligibleAt: initialNextEligibleAt(input.schedule, ownerTimeZone, now),
			createdAt: now,
			updatedAt: now
		})
		.returning({ id: selfTasks.id });
	return row.id;
}

export async function getSelfTaskForUser(
	db: Db,
	userId: string,
	viewerTimezone: string,
	taskId: string
): Promise<SelfTaskView | null> {
	const rows = await db
		.select(selfTaskColumns)
		.from(selfTasks)
		.where(and(eq(selfTasks.id, taskId), eq(selfTasks.ownerId, userId)))
		.limit(1);
	const row = rows[0];
	if (!row) return null;
	return toSelfTaskView(row, viewerTimezone);
}

export async function updateSelfTask(
	db: Db,
	userId: string,
	ownerTimeZone: string,
	taskId: string,
	input: TaskInput
): Promise<boolean> {
	const nextEligibleAt = initialNextEligibleAt(input.schedule, ownerTimeZone);
	const rows = await db
		.update(selfTasks)
		.set({
			title: input.title,
			description: input.description,
			active: input.active,
			creditsAwarded: input.creditsAwarded,
			completionMessages: input.completionMessages,
			schedule: input.schedule,
			timezoneOwnerUserId: userId,
			nextEligibleAt,
			updatedAt: new Date()
		})
		.where(and(eq(selfTasks.id, taskId), eq(selfTasks.ownerId, userId)))
		.returning({ id: selfTasks.id });
	return rows.length > 0;
}

export async function getPartnershipTasksPage(
	db: Db,
	partnershipId: string,
	userId: string,
	viewerTimezone: string
): Promise<PartnershipTasksPageView | null> {
	const membership = await requireTaskMembership(db, partnershipId, userId, viewerTimezone);
	if (!membership) return null;
	const visibilityRecord = {
		status: membership.partnership.status,
		control: membership.partnership.control,
		inviterId:
			membership.partnership.role === 'inviter'
				? membership.viewerId
				: membership.counterpartUserId,
		inviteeId:
			membership.partnership.role === 'invitee' ? membership.viewerId : membership.counterpartUserId
	};

	const [tasks, completions] = await Promise.all([
		db
			.select(partnershipTaskColumns)
			.from(partnershipTasks)
			.where(eq(partnershipTasks.partnershipId, partnershipId))
			.orderBy(
				desc(partnershipTasks.active),
				desc(partnershipTasks.createdAt),
				asc(partnershipTasks.id)
			),
		db
			.select(partnershipTaskCompletionColumns)
			.from(partnershipTaskCompletions)
			.where(eq(partnershipTaskCompletions.partnershipId, partnershipId))
			.orderBy(desc(partnershipTaskCompletions.createdAt), desc(partnershipTaskCompletions.id))
	]);

	return {
		partner: {
			id: partnershipId,
			name: membership.partnership.partnerName,
			canManageTasks: membership.canManage,
			canCompleteTasks: membership.canComplete,
			counterpartUserId: membership.counterpartUserId,
			counterpartTimezone: membership.counterpartTimezone
		},
		tasks: tasks
			.filter((row) =>
				canViewPartnershipTask(
					{
						...visibilityRecord,
						partnershipId: row.partnershipId,
						createdByUserId: row.createdByUserId,
						active: row.active,
						nextEligibleAt: row.nextEligibleAt
					},
					userId
				)
			)
			.map((row) => toPartnershipTaskView(row, membership)),
		completions: completions.map((row) => toPartnershipTaskCompletionView(row, userId))
	};
}

export async function createPartnershipTask(
	db: Db,
	partnershipId: string,
	userId: string,
	viewerTimezone: string,
	input: TaskInput
): Promise<CreateTaskResult<'not-a-member' | 'forbidden' | 'bad-timezone-owner'>> {
	const membership = await requireTaskMembership(db, partnershipId, userId, viewerTimezone);
	if (!membership) return { ok: false, reason: 'not-a-member' };
	if (!membership.canManage) return { ok: false, reason: 'forbidden' };
	if (
		input.timezoneOwnerUserId !== membership.viewerId &&
		input.timezoneOwnerUserId !== membership.counterpartUserId
	) {
		return { ok: false, reason: 'bad-timezone-owner' };
	}
	const ownerTimeZone =
		input.timezoneOwnerUserId === membership.viewerId
			? membership.viewerTimezone
			: membership.counterpartTimezone;
	const now = new Date();

	const [row] = await db
		.insert(partnershipTasks)
		.values({
			partnershipId,
			createdByUserId: userId,
			timezoneOwnerUserId: input.timezoneOwnerUserId,
			title: input.title,
			description: input.description,
			active: input.active,
			creditsAwarded: input.creditsAwarded,
			completionMessages: input.completionMessages,
			schedule: input.schedule,
			nextEligibleAt: initialNextEligibleAt(input.schedule, ownerTimeZone, now),
			createdAt: now,
			updatedAt: now
		})
		.returning({ id: partnershipTasks.id });

	return { ok: true, id: row.id };
}

export async function getPartnershipTaskForUser(
	db: Db,
	partnershipId: string,
	userId: string,
	viewerTimezone: string,
	taskId: string
): Promise<{
	partner: {
		id: string;
		name: string;
		canManageTasks: boolean;
		canCompleteTasks: boolean;
		counterpartUserId: string;
		counterpartTimezone: string;
	};
	task: PartnershipTaskView;
} | null> {
	const membership = await requireTaskMembership(db, partnershipId, userId, viewerTimezone);
	if (!membership) return null;

	const rows = await db
		.select(partnershipTaskColumns)
		.from(partnershipTasks)
		.where(and(eq(partnershipTasks.id, taskId), eq(partnershipTasks.partnershipId, partnershipId)))
		.limit(1);
	const row = rows[0];
	if (!row) return null;

	return {
		partner: {
			id: partnershipId,
			name: membership.partnership.partnerName,
			canManageTasks: membership.canManage,
			canCompleteTasks: membership.canComplete,
			counterpartUserId: membership.counterpartUserId,
			counterpartTimezone: membership.counterpartTimezone
		},
		task: toPartnershipTaskView(row, membership)
	};
}

export async function updatePartnershipTask(
	db: Db,
	partnershipId: string,
	userId: string,
	viewerTimezone: string,
	taskId: string,
	input: TaskInput
): Promise<TaskResult<'not-a-member' | 'forbidden' | 'not-found' | 'bad-timezone-owner'>> {
	const membership = await requireTaskMembership(db, partnershipId, userId, viewerTimezone);
	if (!membership) return { ok: false, reason: 'not-a-member' };
	if (!membership.canManage) return { ok: false, reason: 'forbidden' };
	if (
		input.timezoneOwnerUserId !== membership.viewerId &&
		input.timezoneOwnerUserId !== membership.counterpartUserId
	) {
		return { ok: false, reason: 'bad-timezone-owner' };
	}
	const ownerTimeZone =
		input.timezoneOwnerUserId === membership.viewerId
			? membership.viewerTimezone
			: membership.counterpartTimezone;

	const existingRows = await db
		.select({ createdByUserId: partnershipTasks.createdByUserId })
		.from(partnershipTasks)
		.where(and(eq(partnershipTasks.id, taskId), eq(partnershipTasks.partnershipId, partnershipId)))
		.limit(1);
	const existing = existingRows[0];
	if (!existing) return { ok: false, reason: 'not-found' };
	if (existing.createdByUserId !== userId) return { ok: false, reason: 'forbidden' };

	const rows = await db
		.update(partnershipTasks)
		.set({
			timezoneOwnerUserId: input.timezoneOwnerUserId,
			title: input.title,
			description: input.description,
			active: input.active,
			creditsAwarded: input.creditsAwarded,
			completionMessages: input.completionMessages,
			schedule: input.schedule,
			nextEligibleAt: initialNextEligibleAt(input.schedule, ownerTimeZone),
			updatedAt: new Date()
		})
		.where(and(eq(partnershipTasks.id, taskId), eq(partnershipTasks.partnershipId, partnershipId)))
		.returning({ id: partnershipTasks.id });
	if (rows.length === 0) return { ok: false, reason: 'not-found' };
	return { ok: true };
}

export async function completeSelfTask(
	db: Db,
	userId: string,
	viewerTimezone: string,
	taskId: string,
	now: Date = new Date()
): Promise<TaskResult<'not-found' | 'inactive' | 'not-ready'>> {
	const rows = await db
		.select(selfTaskColumns)
		.from(selfTasks)
		.where(and(eq(selfTasks.id, taskId), eq(selfTasks.ownerId, userId)))
		.limit(1);
	const task = rows[0];
	if (!task) return { ok: false, reason: 'not-found' };
	if (!task.active) return { ok: false, reason: 'inactive' };
	if (!isTaskCompletableAt(task, now)) return { ok: false, reason: 'not-ready' };

	const ownerTimeZone = viewerTimezone;
	const recentCompletions =
		task.schedule.mode === 'rolling-window' && task.schedule.limit
			? await recentSelfTaskCompletionTimes(
					db,
					task.id,
					Math.max(task.schedule.limit.completions - 1, 0)
				)
			: [];
	const nextEligibleAt = nextEligibleAtAfterCompletion(
		task.schedule,
		ownerTimeZone,
		now,
		recentCompletions
	);
	const completionMessage = chooseCompletionMessage(task.completionMessages);
	const nextCredits = (await readSelfRewardCredits(db, userId)) + task.creditsAwarded;
	const nextActive = task.schedule.mode === 'one-off' ? false : task.active;

	await db.batch([
		db.insert(selfTaskCompletions).values({
			ownerId: userId,
			taskId: task.id,
			taskTitle: task.title,
			taskDescription: task.description,
			creditsAwarded: task.creditsAwarded,
			completionMessage,
			createdAt: now,
			updatedAt: now
		}),
		db
			.update(selfTasks)
			.set({
				active: nextActive,
				lastCompletedAt: now,
				completedCount: task.completedCount + 1,
				nextEligibleAt,
				updatedAt: now
			})
			.where(and(eq(selfTasks.id, taskId), eq(selfTasks.ownerId, userId))),
		db
			.insert(selfRewardCredits)
			.values({ ownerId: userId, credits: nextCredits, createdAt: now, updatedAt: now })
			.onConflictDoUpdate({
				target: selfRewardCredits.ownerId,
				set: { credits: nextCredits, updatedAt: now }
			})
	]);

	return { ok: true };
}

export async function completePartnershipTask(
	db: Db,
	input: { partnershipId: string; taskId: string; userId: string; viewerTimezone: string },
	now: Date = new Date()
): Promise<
	TaskResult<'not-a-member' | 'not-found' | 'not-allowed' | 'inactive' | 'own-task' | 'not-ready'>
> {
	const membership = await requireTaskMembership(
		db,
		input.partnershipId,
		input.userId,
		input.viewerTimezone
	);
	if (!membership) return { ok: false, reason: 'not-a-member' };
	if (!membership.canComplete) return { ok: false, reason: 'not-allowed' };

	const rows = await db
		.select(partnershipTaskColumns)
		.from(partnershipTasks)
		.where(
			and(
				eq(partnershipTasks.id, input.taskId),
				eq(partnershipTasks.partnershipId, input.partnershipId)
			)
		)
		.limit(1);
	const task = rows[0];
	if (!task) return { ok: false, reason: 'not-found' };
	if (!task.active) return { ok: false, reason: 'inactive' };
	if (task.createdByUserId === input.userId) return { ok: false, reason: 'own-task' };
	if (!isTaskCompletableAt(task, now)) return { ok: false, reason: 'not-ready' };

	const ownerTimeZone =
		task.timezoneOwnerUserId === membership.viewerId
			? membership.viewerTimezone
			: membership.counterpartTimezone;
	const recentCompletions =
		task.schedule.mode === 'rolling-window' && task.schedule.limit
			? await recentPartnershipTaskCompletionTimes(
					db,
					task.id,
					Math.max(task.schedule.limit.completions - 1, 0)
				)
			: [];
	const nextEligibleAt = nextEligibleAtAfterCompletion(
		task.schedule,
		ownerTimeZone,
		now,
		recentCompletions
	);
	const completionMessage = chooseCompletionMessage(task.completionMessages);
	const nextCredits =
		(await readPartnershipRewardCredits(db, input.partnershipId, input.userId)) +
		task.creditsAwarded;
	const nextActive = task.schedule.mode === 'one-off' ? false : task.active;

	await db.batch([
		db.insert(partnershipTaskCompletions).values({
			partnershipId: input.partnershipId,
			taskId: task.id,
			completedByUserId: input.userId,
			createdByUserId: task.createdByUserId,
			taskTitle: task.title,
			taskDescription: task.description,
			creditsAwarded: task.creditsAwarded,
			completionMessage,
			createdAt: now,
			updatedAt: now
		}),
		db
			.update(partnershipTasks)
			.set({
				active: nextActive,
				lastCompletedAt: now,
				completedCount: task.completedCount + 1,
				nextEligibleAt,
				updatedAt: now
			})
			.where(
				and(
					eq(partnershipTasks.id, input.taskId),
					eq(partnershipTasks.partnershipId, input.partnershipId)
				)
			),
		db
			.insert(partnershipRewardCredits)
			.values({
				partnershipId: input.partnershipId,
				userId: input.userId,
				credits: nextCredits,
				createdAt: now,
				updatedAt: now
			})
			.onConflictDoUpdate({
				target: [partnershipRewardCredits.partnershipId, partnershipRewardCredits.userId],
				set: { credits: nextCredits, updatedAt: now }
			})
	]);

	return { ok: true };
}

export async function listHomePartnerTaskSections(
	db: Db,
	userId: string,
	viewerTimezone: string,
	partners: PartnerView[]
): Promise<HomePartnerTasksSectionView[]> {
	if (partners.length === 0) return [];

	const partnershipIds = partners.map((partner) => partner.id);
	const [partnershipRows, taskRows] = await Promise.all([
		db
			.select({
				id: partnerships.id,
				status: partnerships.status,
				control: partnerships.control,
				inviterId: partnerships.inviterId,
				inviteeId: partnerships.inviteeId,
				inviterName: partnerships.inviterName,
				inviteeName: partnerships.inviteeName,
				inviterRole: partnerships.inviterRole,
				inviteeRole: partnerships.inviteeRole
			})
			.from(partnerships)
			.where(inArray(partnerships.id, partnershipIds)),
		db
			.select(partnershipTaskColumns)
			.from(partnershipTasks)
			.where(
				and(
					inArray(partnershipTasks.partnershipId, partnershipIds),
					eq(partnershipTasks.active, true)
				)
			)
			.orderBy(desc(partnershipTasks.createdAt), asc(partnershipTasks.id))
	]);

	const completablePartnerships = new Map(
		partnershipRows.map((row) => [
			row.id,
			row.status === 'accepted' &&
				(row.control === 'both' ||
					row.control !==
						(row.inviterId === userId ? 'inviter' : row.inviteeId === userId ? 'invitee' : null))
		])
	);
	const tasksByPartnership = new Map<string, PartnershipTaskView[]>();
	const partnerById = new Map(partners.map((partner) => [partner.id, partner]));

	for (const row of taskRows) {
		if (!completablePartnerships.get(row.partnershipId)) continue;
		if (row.createdByUserId === userId) continue;
		const partner = partnerById.get(row.partnershipId);
		if (!partner) continue;
		const membership = await requireTaskMembership(db, row.partnershipId, userId, viewerTimezone);
		if (!membership) continue;
		const list = tasksByPartnership.get(row.partnershipId) ?? [];
		list.push(toPartnershipTaskView(row, membership));
		tasksByPartnership.set(row.partnershipId, list);
	}

	return partners.flatMap((partner) => {
		if (!completablePartnerships.get(partner.id)) return [];
		return [
			{
				partnershipId: partner.id,
				name: partner.name,
				image: partner.image,
				tasks: tasksByPartnership.get(partner.id) ?? []
			}
		];
	});
}
