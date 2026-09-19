import { and, eq } from 'drizzle-orm';
import type { Db } from '../server/db';
import {
	messageAttachments,
	messageThreads,
	messages,
	partnershipTaskCompletions,
	partnershipTasks,
	partnershipRewardClaims,
	partnershipRewardCredits,
	partnershipRewards,
	partnerships,
	selfTaskCompletions,
	selfTasks,
	selfRewardClaims,
	selfRewardCredits,
	selfRewards,
	threadReads,
	user,
	userKeyWraps,
	userKeys
} from '../server/db/schema';
import { acceptInvite, createInvite } from '../server/partnerships';
import { acknowledgeHistoryWarning, putUserKeys } from '../server/keys';
import { FAKE_WRAP_BLOB, PASSWORD_WRAP_PARAMS } from './crypto';
import { generateAgeIdentity } from '../crypto/identity';
import { sendMessage, startThread, type OutgoingAttachment } from '../server/messaging';
import type { MediaStore } from '../server/media';
import { createTestMediaStore } from './media';
import type { ThreadIcon } from '../messaging';
import type { ControlAnswer } from '../partnership';
import { controlFromAnswer } from '../partnership';
import {
	claimPartnershipReward,
	claimSelfReward,
	createPartnershipReward,
	createSelfReward,
	setPartnershipRewardCredits,
	setSelfRewardCredits
} from '../server/rewards';
import type { RewardInput } from '../rewards';
import { createPartnershipTask, createSelfTask } from '../server/tasks';
import type { TaskInput } from '../tasks';
import type { TaskSchedule } from '../types';

/**
 * Fixtures for the partners tests.
 *
 * Users are inserted straight into the `user` table rather than going through
 * Better Auth: nothing under test reads a password, a session or an account
 * row, and booting the auth instance would drag in `sveltekitCookies`, which
 * needs a live request context. The e2e suite covers the real signup path.
 */

let counter = 0;

/**
 * A strictly increasing clock for fixtures that do not pin their own time.
 *
 * `new Date()` is the obvious default and it is subtly wrong here: two writes
 * in the same millisecond fall back to the `id` tiebreak, which is a UUID, so
 * the order becomes arbitrary and a test that reads `messages[1]` passes or
 * fails depending on which UUID sorted first. That produced a genuine flake
 * that only appeared when the whole suite ran.
 *
 * Starts well in the past so a fixture time never collides with a real
 * `new Date()` written by code under test.
 */
let fixtureClock = new Date('2020-01-01T00:00:00.000Z').getTime();

function nextFixtureTime(): Date {
	fixtureClock += 1000;
	return new Date(fixtureClock);
}

export type TestUser = {
	id: string;
	name: string;
	email: string;
	image: string | null;
	timezone: string;
};

export async function createTestUser(db: Db, overrides: Partial<TestUser> = {}): Promise<TestUser> {
	counter += 1;
	const row: TestUser = {
		id: overrides.id ?? `user-${counter}`,
		name: overrides.name ?? `Test User ${counter}`,
		email: overrides.email ?? `user-${counter}@example.test`,
		image: overrides.image ?? null,
		timezone: overrides.timezone ?? 'UTC'
	};

	await db.insert(user).values({
		id: row.id,
		name: row.name,
		email: row.email,
		emailVerified: false,
		image: row.image,
		timezone: row.timezone,
		createdAt: new Date(),
		updatedAt: new Date()
	});

	return row;
}

/** A pending invite, as `/settings/partners/new` would create it. */
export async function createTestInvite(
	db: Db,
	inviter: TestUser,
	options: {
		partnerName?: string;
		yourName?: string;
		partnerRole?: string | null;
		yourRole?: string | null;
		/** Answered from the inviter's side, exactly as the form asks it. */
		control?: ControlAnswer;
		now?: Date;
	} = {}
) {
	return createInvite(
		db,
		{
			inviterId: inviter.id,
			inviteeName: options.partnerName ?? 'Them',
			inviterName: options.yourName ?? 'You',
			inviteeRole: options.partnerRole ?? null,
			inviterRole: options.yourRole ?? null,
			control: controlFromAnswer(options.control ?? 'mix', 'inviter')
		},
		options.now ?? new Date()
	);
}

/** A fully linked pair, created through the real invite → accept path. */
export async function createTestPartnership(
	db: Db,
	inviter: TestUser,
	invitee: TestUser,
	options: Parameters<typeof createTestInvite>[2] = {}
): Promise<{ id: string }> {
	const invite = await createTestInvite(db, inviter, options);
	const result = await acceptInvite(db, { token: invite.inviteToken, inviteeId: invitee.id });
	if (!result.ok) throw new Error(`fixture could not accept invite: ${result.reason}`);
	return { id: result.id };
}

/** Pushes a pending invite's expiry into the past. */
export async function expireInvite(db: Db, partnershipId: string): Promise<void> {
	await db
		.update(partnerships)
		.set({ inviteExpiresAt: new Date(Date.now() - 1000) })
		.where(eq(partnerships.id, partnershipId));
}

/** The raw row, for assertions about columns the view layer hides. */
export async function readPartnershipRow(db: Db, id: string) {
	const rows = await db.select().from(partnerships).where(eq(partnerships.id, id)).limit(1);
	return rows[0];
}

/**
 * Gives a user a recipient and one password wrap, as signup would.
 *
 * Generates a genuine age keypair rather than a synthetic string, because a
 * recipient is bech32 with a checksum and a made-up one would pass a regex but
 * fail anything that actually decoded it. X25519 keygen is about a millisecond,
 * so this is cheaper than the class of confusing failure it avoids.
 *
 * Goes through `putUserKeys` so a test relying on the unique constraint or the
 * batch is exercising the real path.
 */
export async function createTestUserKeys(
	db: Db,
	owner: TestUser,
	options: { recipient?: string; acknowledged?: boolean; embedAutoLoad?: boolean | null } = {}
): Promise<{ identity: string; recipient: string }> {
	const generated = await generateAgeIdentity();
	const recipient = options.recipient ?? generated.recipient;
	await putUserKeys(db, owner.id, {
		recipient,
		wrap: { type: 'password', params: PASSWORD_WRAP_PARAMS, blob: FAKE_WRAP_BLOB }
	});
	if (options.acknowledged) await acknowledgeHistoryWarning(db, owner.id);
	if (options.embedAutoLoad !== undefined) {
		await db
			.update(userKeys)
			.set({ embedAutoLoad: options.embedAutoLoad })
			.where(eq(userKeys.userId, owner.id));
	}
	return { identity: generated.identity, recipient };
}

/** The raw key row, for assertions about columns the view layer hides. */
export async function readUserKeysRow(db: Db, userId: string) {
	const rows = await db.select().from(userKeys).where(eq(userKeys.userId, userId)).limit(1);
	return rows[0];
}

/** Every wrap row for a user, for counting after a password change. */
export async function readWrapRows(db: Db, userId: string) {
	return db.select().from(userKeyWraps).where(eq(userKeyWraps.userId, userId));
}

export async function createTestSelfReward(
	db: Db,
	owner: TestUser,
	input: Partial<RewardInput> = {}
): Promise<{ id: string }> {
	const id = await createSelfReward(db, owner.id, {
		title: input.title ?? 'Reward',
		description: input.description ?? 'Reward description',
		cost: input.cost ?? 3,
		active: input.active ?? true
	});
	return { id };
}

export async function setTestSelfRewardCredits(
	db: Db,
	owner: TestUser,
	credits: number
): Promise<void> {
	await setSelfRewardCredits(db, owner.id, credits);
}

export async function claimTestSelfReward(
	db: Db,
	owner: TestUser,
	rewardId: string
): Promise<void> {
	const result = await claimSelfReward(db, owner.id, rewardId);
	if (!result.ok) throw new Error(`fixture could not claim self reward: ${result.reason}`);
}

export async function readSelfRewardRow(db: Db, id: string) {
	const rows = await db.select().from(selfRewards).where(eq(selfRewards.id, id)).limit(1);
	return rows[0];
}

export async function readSelfRewardCreditRow(db: Db, ownerId: string) {
	const rows = await db
		.select()
		.from(selfRewardCredits)
		.where(eq(selfRewardCredits.ownerId, ownerId))
		.limit(1);
	return rows[0];
}

export async function readSelfRewardClaimRows(db: Db, ownerId: string) {
	return db
		.select()
		.from(selfRewardClaims)
		.where(eq(selfRewardClaims.ownerId, ownerId))
		.orderBy(selfRewardClaims.createdAt, selfRewardClaims.id);
}

export async function createTestPartnershipReward(
	db: Db,
	partnershipId: string,
	owner: TestUser,
	input: Partial<RewardInput> = {}
): Promise<{ id: string }> {
	const result = await createPartnershipReward(db, partnershipId, owner.id, {
		title: input.title ?? 'Partner reward',
		description: input.description ?? 'Partner reward description',
		cost: input.cost ?? 2,
		active: input.active ?? true
	});
	if (!result.ok) throw new Error(`fixture could not create partnership reward: ${result.reason}`);
	return { id: result.id };
}

export async function setTestPartnershipRewardCredits(
	db: Db,
	partnershipId: string,
	actor: TestUser,
	target: TestUser,
	credits: number
): Promise<void> {
	const result = await setPartnershipRewardCredits(db, partnershipId, actor.id, target.id, credits);
	if (!result.ok) throw new Error(`fixture could not set partnership credits: ${result.reason}`);
}

export async function claimTestPartnershipReward(
	db: Db,
	partnershipId: string,
	viewer: TestUser,
	rewardId: string
): Promise<void> {
	const result = await claimPartnershipReward(db, { partnershipId, rewardId, userId: viewer.id });
	if (!result.ok) throw new Error(`fixture could not claim partnership reward: ${result.reason}`);
}

export async function readPartnershipRewardRow(db: Db, id: string) {
	const rows = await db
		.select()
		.from(partnershipRewards)
		.where(eq(partnershipRewards.id, id))
		.limit(1);
	return rows[0];
}

export async function readPartnershipRewardRows(db: Db, partnershipId: string) {
	return db
		.select()
		.from(partnershipRewards)
		.where(eq(partnershipRewards.partnershipId, partnershipId))
		.orderBy(partnershipRewards.createdAt, partnershipRewards.id);
}

export async function readPartnershipRewardCreditRow(
	db: Db,
	partnershipId: string,
	userId: string
) {
	const rows = await db
		.select()
		.from(partnershipRewardCredits)
		.where(
			and(
				eq(partnershipRewardCredits.partnershipId, partnershipId),
				eq(partnershipRewardCredits.userId, userId)
			)
		)
		.limit(1);
	return rows[0];
}

export async function readPartnershipRewardClaimRows(db: Db, partnershipId: string) {
	return db
		.select()
		.from(partnershipRewardClaims)
		.where(eq(partnershipRewardClaims.partnershipId, partnershipId))
		.orderBy(partnershipRewardClaims.createdAt, partnershipRewardClaims.id);
}

function defaultTaskSchedule(): TaskSchedule {
	return { mode: 'one-off' };
}

export async function createTestSelfTask(
	db: Db,
	owner: TestUser,
	input: Partial<TaskInput> = {}
): Promise<{ id: string }> {
	const id = await createSelfTask(db, owner.id, owner.timezone, {
		title: input.title ?? 'Self task',
		description: input.description ?? 'Self task description',
		active: input.active ?? true,
		creditsAwarded: input.creditsAwarded ?? 2,
		completionMessages: input.completionMessages ?? ['Nice work'],
		schedule: input.schedule ?? defaultTaskSchedule(),
		timezoneOwnerUserId: input.timezoneOwnerUserId ?? owner.id
	});
	return { id };
}

export async function createTestPartnershipTask(
	db: Db,
	partnershipId: string,
	viewer: TestUser,
	input: Partial<TaskInput> = {}
): Promise<{ id: string }> {
	const result = await createPartnershipTask(db, partnershipId, viewer.id, viewer.timezone, {
		title: input.title ?? 'Partner task',
		description: input.description ?? 'Partner task description',
		active: input.active ?? true,
		creditsAwarded: input.creditsAwarded ?? 2,
		completionMessages: input.completionMessages ?? ['Nicely done'],
		schedule: input.schedule ?? defaultTaskSchedule(),
		timezoneOwnerUserId: input.timezoneOwnerUserId ?? viewer.id
	});
	if (!result.ok) throw new Error(`fixture could not create partnership task: ${result.reason}`);
	return { id: result.id };
}

export async function readSelfTaskRow(db: Db, id: string) {
	const rows = await db.select().from(selfTasks).where(eq(selfTasks.id, id)).limit(1);
	return rows[0];
}

export async function readSelfTaskCompletionRows(db: Db, ownerId: string) {
	return db
		.select()
		.from(selfTaskCompletions)
		.where(eq(selfTaskCompletions.ownerId, ownerId))
		.orderBy(selfTaskCompletions.createdAt, selfTaskCompletions.id);
}

export async function readPartnershipTaskRow(db: Db, id: string) {
	const rows = await db.select().from(partnershipTasks).where(eq(partnershipTasks.id, id)).limit(1);
	return rows[0];
}

export async function readPartnershipTaskRows(db: Db, partnershipId: string) {
	return db
		.select()
		.from(partnershipTasks)
		.where(eq(partnershipTasks.partnershipId, partnershipId))
		.orderBy(partnershipTasks.createdAt, partnershipTasks.id);
}

export async function readPartnershipTaskCompletionRows(db: Db, partnershipId: string) {
	return db
		.select()
		.from(partnershipTaskCompletions)
		.where(eq(partnershipTaskCompletions.partnershipId, partnershipId))
		.orderBy(partnershipTaskCompletions.createdAt, partnershipTaskCompletions.id);
}

/**
 * A thread with one message, through the real `startThread` path.
 *
 * `at` sets both the thread's `last_message_at` and the message's timestamp, so
 * a test can lay out a board in a known order without sleeping.
 */
export async function createTestThread(
	db: Db,
	partnershipId: string,
	sender: TestUser,
	options: {
		icon?: ThreadIcon;
		ciphertext?: string;
		metadataCiphertext?: string;
		at?: Date;
		attachments?: OutgoingAttachment[];
		store?: MediaStore;
	} = {}
): Promise<{ threadId: string; messageId: string }> {
	const result = await startThread(
		db,
		options.store ?? createTestMediaStore(),
		{
			partnershipId,
			senderId: sender.id,
			icon: options.icon ?? 'envelope',
			ciphertext: options.ciphertext ?? 'Y2lwaGVydGV4dA',
			metadataCiphertext: options.metadataCiphertext,
			attachments: options.attachments ?? []
		},
		options.at ?? nextFixtureTime()
	);
	if (!result.ok) throw new Error(`fixture could not start a thread: ${result.reason}`);
	return { threadId: result.threadId, messageId: result.messageId };
}

/** A reply, through the real `sendMessage` path. */
export async function createTestMessage(
	db: Db,
	partnershipId: string,
	threadId: string,
	sender: TestUser,
	options: {
		ciphertext?: string;
		metadataCiphertext?: string;
		at?: Date;
		attachments?: OutgoingAttachment[];
		store?: MediaStore;
	} = {}
): Promise<{ messageId: string }> {
	const result = await sendMessage(
		db,
		options.store ?? createTestMediaStore(),
		{
			partnershipId,
			threadId,
			senderId: sender.id,
			ciphertext: options.ciphertext ?? 'cmVwbHk',
			metadataCiphertext: options.metadataCiphertext,
			attachments: options.attachments ?? []
		},
		options.at ?? nextFixtureTime()
	);
	if (!result.ok) throw new Error(`fixture could not send a message: ${result.reason}`);
	return { messageId: result.messageId };
}

/** The raw thread row, for assertions about the denormalised columns. */
export async function readThreadRow(db: Db, threadId: string) {
	const rows = await db
		.select()
		.from(messageThreads)
		.where(eq(messageThreads.id, threadId))
		.limit(1);
	return rows[0];
}

/** Every read-state row for a thread, for counting who has opened it. */
export async function readThreadReadRows(db: Db, threadId: string) {
	return db.select().from(threadReads).where(eq(threadReads.threadId, threadId));
}

/** All attachment rows for a message. */
export async function readAttachmentRows(db: Db, messageId: string) {
	return db.select().from(messageAttachments).where(eq(messageAttachments.messageId, messageId));
}

/** Every message row in a thread, oldest first. */
export async function readMessageRows(db: Db, threadId: string) {
	return db
		.select()
		.from(messages)
		.where(eq(messages.threadId, threadId))
		.orderBy(messages.createdAt, messages.id);
}

/**
 * LEGACY-RICHTEXT — marks a message as written before rich text existed.
 *
 * `sendMessage` writes `'lexical'`, so a test that needs a pre-migration row
 * has to say so. Delete with the rest; see docs/temporary-code.md.
 */
export async function markMessageBodyLegacy(db: Db, messageId: string): Promise<void> {
	await db.update(messages).set({ bodyFormat: 'plain' }).where(eq(messages.id, messageId));
}
