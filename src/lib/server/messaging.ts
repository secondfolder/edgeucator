import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Db } from './db';
import {
	historyRestoreRequests,
	messageAttachments,
	messageReactions,
	messageThreads,
	messages,
	threadReads
} from './db/schema';
import { getPartnershipForUser } from './partnerships';
import type { PartnershipView } from '../partnership';
import {
	BOARD_LIMIT,
	MAX_ATTACHMENTS_PER_MESSAGE,
	MAX_ATTACHMENT_TOTAL_BYTES,
	MAX_CIPHERTEXT_BYTES,
	MAX_REACTION_CIPHERTEXT_BYTES,
	isThreadIcon,
	type ThreadIcon
} from '../messaging';
import { attachmentKey, partnershipMediaPrefix, type MediaStore } from './media';
import type {
	MessageView,
	ThreadStickerView,
	ThreadView,
	UnreadPartnerView,
	RestoreRequestView
} from '../types';
import type { PartnerView } from '../types';

/**
 * Every database access for messaging.
 *
 * Membership is never re-derived in here. Every entry point goes through
 * `requireMembership`, which is a thin wrapper over `getPartnershipForUser` in
 * `server/partnerships.ts` — so there is exactly one definition of "am I in
 * this?", and a route can 404 on a null without a second check.
 *
 * The server handles ciphertext and never inspects it. The single exception is
 * `icon`, which is plaintext because the board must render before any key is
 * unlocked; every write path re-validates it against the closed list, because a
 * free-text plaintext column reachable from the network would be a covert
 * channel (AGENTS.md invariant 13).
 */

// ── column lists ─────────────────────────────────────────────────────────────

/** Only what a sticker needs. D1 bills on bytes read, and `ciphertext` is big. */
const threadStickerColumns = {
	id: messageThreads.id,
	icon: messageThreads.icon,
	lastMessageAt: messageThreads.lastMessageAt,
	lastMessageSenderId: messageThreads.lastMessageSenderId,
	lastOpenedAt: threadReads.lastOpenedAt,
	lastReadMessageAt: threadReads.lastReadMessageAt
} as const;

const messageColumns = {
	id: messages.id,
	senderId: messages.senderId,
	ciphertext: messages.ciphertext,
	createdAt: messages.createdAt
} as const;

// ── membership ───────────────────────────────────────────────────────────────

export type Membership = {
	partnership: PartnershipView;
	viewerId: string;
};

/**
 * The gate every public function here goes through.
 *
 * Returns null rather than throwing, so a route reads `if (!m) error(404)`.
 * 404 and not 403, matching the existing partner routes: distinguishing them
 * would confirm the id is real.
 *
 * Pending partnerships are refused — there is nobody to message yet, and no
 * second recipient to encrypt to.
 */
export async function requireMembership(
	db: Db,
	partnershipId: string,
	userId: string
): Promise<Membership | null> {
	const partnership = await getPartnershipForUser(db, partnershipId, userId);
	if (!partnership || partnership.status !== 'accepted') return null;
	return { partnership, viewerId: userId };
}

/**
 * As above, and also proves the thread belongs to that partnership.
 *
 * The partnership id from the URL is re-joined against the thread rather than
 * trusted. Without that, anyone who is in *any* partnership could read any
 * thread by putting their own partnership id in the path — a confused deputy,
 * and the single most likely way this feature ships with a hole.
 */
export async function requireThreadMembership(
	db: Db,
	partnershipId: string,
	threadId: string,
	userId: string
): Promise<(Membership & { threadId: string; icon: ThreadIcon }) | null> {
	const membership = await requireMembership(db, partnershipId, userId);
	if (!membership) return null;

	const rows = await db
		.select({ id: messageThreads.id, icon: messageThreads.icon })
		.from(messageThreads)
		.where(and(eq(messageThreads.id, threadId), eq(messageThreads.partnershipId, partnershipId)))
		.limit(1);

	const row = rows[0];
	if (!row) return null;
	return { ...membership, threadId: row.id, icon: row.icon };
}

/** As above, for a message. Same re-join, same reason. */
export async function requireMessageMembership(
	db: Db,
	partnershipId: string,
	messageId: string,
	userId: string
): Promise<(Membership & { messageId: string; threadId: string; senderId: string }) | null> {
	const membership = await requireMembership(db, partnershipId, userId);
	if (!membership) return null;

	const rows = await db
		.select({
			id: messages.id,
			threadId: messages.threadId,
			senderId: messages.senderId
		})
		.from(messages)
		.innerJoin(messageThreads, eq(messageThreads.id, messages.threadId))
		.where(and(eq(messages.id, messageId), eq(messageThreads.partnershipId, partnershipId)))
		.limit(1);

	const row = rows[0];
	if (!row) return null;
	return { ...membership, messageId: row.id, threadId: row.threadId, senderId: row.senderId };
}

// ── reads ────────────────────────────────────────────────────────────────────

/**
 * The board: every thread in a partnership, in the order it renders.
 *
 * One statement for both halves. `unread` is defined once, as SQL, and reused
 * in the select and in both sort keys — the JS twin of it is `isUnreadFor` in
 * `src/lib/messaging.ts`, and the two must agree.
 *
 * `messages` is never read here. That is what the two denormalised columns on
 * `message_threads` are for, and it is why drawing a board costs one row per
 * thread rather than one per message.
 */
export async function listBoard(
	db: Db,
	partnershipId: string,
	viewerId: string
): Promise<ThreadStickerView[]> {
	const unread = sql<number>`(
		${messageThreads.lastMessageSenderId} <> ${viewerId}
		and (
			${threadReads.lastReadMessageAt} is null
			or ${messageThreads.lastMessageAt} > ${threadReads.lastReadMessageAt}
		)
	)`;

	const messageCount = sql<number>`(
		select count(*) from ${messages} where ${messages.threadId} = ${messageThreads.id}
	)`;

	const rows = await db
		.select({ ...threadStickerColumns, unread, messageCount })
		.from(messageThreads)
		// The user predicate belongs in the ON, not the WHERE. In the WHERE it
		// turns this left join into an inner one and every thread the viewer has
		// never opened silently disappears from their own board.
		.leftJoin(
			threadReads,
			and(eq(threadReads.threadId, messageThreads.id), eq(threadReads.userId, viewerId))
		)
		.where(eq(messageThreads.partnershipId, partnershipId))
		.orderBy(
			// Requirement: unread first, newest at the top; then read, most
			// recently opened first. The CASE is what lets the two halves sort on
			// different columns without a second round trip.
			desc(unread),
			desc(sql`case when ${unread} then ${messageThreads.lastMessageAt}
			              else ${threadReads.lastOpenedAt} end`),
			asc(messageThreads.id)
		)
		.limit(BOARD_LIMIT);

	return rows.map((row) => ({
		id: row.id,
		icon: row.icon,
		// SQLite has no boolean, so this arrives as 0/1. Normalised here so no
		// component ever receives a number pretending to be a flag.
		unread: Boolean(row.unread),
		lastMessageAt: row.lastMessageAt,
		lastOpenedAt: row.lastOpenedAt ?? null,
		messageCount: Number(row.messageCount)
	}));
}

/**
 * One thread with its messages, attachment metadata and reactions.
 *
 * Three queries, never N+1: attachments and reactions are fetched for the whole
 * message set with `inArray`. The Free plan allows 50 D1 queries per Worker
 * invocation, so a per-message fetch would break production while passing
 * locally, where the limit is not enforced.
 */
export async function getThread(
	db: Db,
	threadId: string,
	icon: ThreadIcon,
	viewerId: string
): Promise<ThreadView> {
	const rows = await db
		.select(messageColumns)
		.from(messages)
		.where(eq(messages.threadId, threadId))
		// Never by id alone — ids are UUIDs (invariant 8). `id` is the tiebreak
		// for two messages inside the same millisecond.
		.orderBy(asc(messages.createdAt), asc(messages.id));

	const ids = rows.map((row) => row.id);
	const [attachments, reactions] = await Promise.all([
		ids.length
			? db
					.select({
						id: messageAttachments.id,
						messageId: messageAttachments.messageId,
						byteSize: messageAttachments.byteSize
					})
					.from(messageAttachments)
					.where(inArray(messageAttachments.messageId, ids))
					.orderBy(asc(messageAttachments.createdAt), asc(messageAttachments.id))
			: [],
		ids.length
			? db
					.select({
						messageId: messageReactions.messageId,
						userId: messageReactions.userId,
						ciphertext: messageReactions.ciphertext
					})
					.from(messageReactions)
					.where(inArray(messageReactions.messageId, ids))
			: []
	]);

	const byMessage = new Map<string, MessageView>();
	const view: ThreadView = {
		id: threadId,
		icon,
		messages: rows.map((row) => {
			const message: MessageView = {
				id: row.id,
				// Resolved here so no component sees a user id, which keeps the
				// "never return locals.user wholesale" posture intact.
				mine: row.senderId === viewerId,
				ciphertext: row.ciphertext,
				createdAt: row.createdAt,
				attachments: [],
				reactions: []
			};
			byMessage.set(row.id, message);
			return message;
		})
	};

	for (const attachment of attachments) {
		byMessage.get(attachment.messageId)?.attachments.push({
			id: attachment.id,
			byteSize: attachment.byteSize
		});
	}
	for (const reaction of reactions) {
		byMessage.get(reaction.messageId)?.reactions.push({
			mine: reaction.userId === viewerId,
			ciphertext: reaction.ciphertext
		});
	}

	return view;
}

/**
 * Per-partnership unread counts for `/home`.
 *
 * Takes the partnership list rather than querying it, so `/home` costs no
 * second read of `partnerships` — the app shell's layout has already loaded it.
 */
export async function listUnreadCounts(
	db: Db,
	userId: string,
	partners: PartnerView[]
): Promise<UnreadPartnerView[]> {
	// `in ()` is a syntax error in SQLite, and a user with no partners is the
	// common case on a fresh account.
	if (partners.length === 0) return [];

	const rows = await db
		.select({
			partnershipId: messageThreads.partnershipId,
			unreadThreads: sql<number>`count(*)`,
			newestAt: sql<number>`max(${messageThreads.lastMessageAt})`
		})
		.from(messageThreads)
		.leftJoin(
			threadReads,
			and(eq(threadReads.threadId, messageThreads.id), eq(threadReads.userId, userId))
		)
		.where(
			and(
				inArray(
					messageThreads.partnershipId,
					partners.map((partner) => partner.id)
				),
				// Not mine, and newer than my read mark. The same predicate as the
				// board's, and it has to stay that way or /home and the board would
				// disagree about what "unread" means.
				ne(messageThreads.lastMessageSenderId, userId),
				sql`(${threadReads.lastReadMessageAt} is null
				     or ${messageThreads.lastMessageAt} > ${threadReads.lastReadMessageAt})`
			)
		)
		.groupBy(messageThreads.partnershipId);

	const counts = new Map(rows.map((row) => [row.partnershipId, row]));

	// Ordered by the nav's own partner order rather than by recency, so the
	// links do not reshuffle under a thumb as messages arrive.
	return partners.flatMap((partner) => {
		const row = counts.get(partner.id);
		if (!row) return [];
		return [
			{
				partnershipId: partner.id,
				name: partner.name,
				image: partner.image,
				unreadThreads: Number(row.unreadThreads),
				newestAt: new Date(Number(row.newestAt))
			}
		];
	});
}

/** The row the download endpoint needs, once membership is proven. */
export async function getAttachmentForDownload(
	db: Db,
	partnershipId: string,
	attachmentId: string
): Promise<{ id: string; storageKey: string; byteSize: number } | null> {
	const rows = await db
		.select({
			id: messageAttachments.id,
			storageKey: messageAttachments.storageKey,
			byteSize: messageAttachments.byteSize
		})
		.from(messageAttachments)
		.innerJoin(messages, eq(messages.id, messageAttachments.messageId))
		.innerJoin(messageThreads, eq(messageThreads.id, messages.threadId))
		// The partnership id is re-joined, not trusted from the URL. Without this
		// join anyone in any partnership could read any attachment by supplying
		// their own partnership id.
		.where(
			and(eq(messageAttachments.id, attachmentId), eq(messageThreads.partnershipId, partnershipId))
		)
		.limit(1);

	return rows[0] ?? null;
}

// ── writes ───────────────────────────────────────────────────────────────────

export type OutgoingAttachment = {
	/**
	 * The row id, chosen by the CLIENT rather than here.
	 *
	 * It has to be, and this is the one place the reason is worth spelling out:
	 * the attachment manifest — including each file's own decryption key — lives
	 * *inside* the encrypted message body, so the ids must be known before the
	 * body is sealed. Letting the server assign them would mean either a second
	 * round trip to re-seal the body, or an unencrypted manifest.
	 *
	 * Client-chosen ids are safe here because they are only ever inserted: a
	 * duplicate collides with the primary key and the insert fails, so one
	 * cannot be used to reach or overwrite an existing row. The endpoint still
	 * checks the shape.
	 */
	id: string;
	/** Already-encrypted bytes. The server never sees a filename or a mime type. */
	body: ReadableStream<Uint8Array>;
	byteSize: number;
};

export type SendFailure =
	| 'not-a-member'
	| 'no-such-thread'
	| 'bad-icon'
	| 'body-too-large'
	| 'too-many-attachments'
	| 'too-many-bytes'
	| 'duplicate-attachment';

export type SendResult =
	{ ok: true; threadId: string; messageId: string } | { ok: false; reason: SendFailure };

function checkPayload(ciphertext: string, attachments: OutgoingAttachment[]): SendFailure | null {
	if (ciphertext.length === 0 || ciphertext.length > MAX_CIPHERTEXT_BYTES) return 'body-too-large';
	if (attachments.length > MAX_ATTACHMENTS_PER_MESSAGE) return 'too-many-attachments';
	const total = attachments.reduce((sum, attachment) => sum + attachment.byteSize, 0);
	if (total > MAX_ATTACHMENT_TOTAL_BYTES) return 'too-many-bytes';
	// Caught here rather than left to the primary key, so the failure is a
	// refusal with a reason instead of a database error after objects have been
	// written to the store.
	const ids = new Set(attachments.map((attachment) => attachment.id));
	if (ids.size !== attachments.length) return 'duplicate-attachment';
	return null;
}

/**
 * Writes the attachment objects, then returns the rows to insert.
 *
 * Objects go to the store BEFORE the database batch, deliberately. A crash
 * between the two then leaves an orphaned encrypted blob — unreadable, and
 * sweepable by prefix — rather than a row pointing at an object that does not
 * exist, which is a permanently broken message in someone's history.
 */
async function writeAttachments(
	store: MediaStore,
	partnershipId: string,
	messageId: string,
	attachments: OutgoingAttachment[]
): Promise<{ id: string; messageId: string; byteSize: number; storageKey: string }[]> {
	const rows = [];
	for (const attachment of attachments) {
		const storageKey = attachmentKey(partnershipId, messageId, attachment.id);
		await store.put(storageKey, attachment.body, attachment.byteSize);
		rows.push({
			id: attachment.id,
			messageId,
			byteSize: attachment.byteSize,
			storageKey
		});
	}
	return rows;
}

/**
 * The read mark for whoever just posted.
 *
 * This is what makes "the newest message is mine" a sound proxy for "I have
 * read this thread", which is what the whole unread definition rests on. It
 * goes in the same batch as the message insert so the two cannot come apart —
 * and it is enforced here rather than relying on the composer only being
 * reachable from an opened thread (invariant 13).
 */
function markSenderRead(db: Db, threadId: string, senderId: string, now: Date) {
	return db
		.insert(threadReads)
		.values({ threadId, userId: senderId, lastOpenedAt: now, lastReadMessageAt: now })
		.onConflictDoUpdate({
			target: [threadReads.threadId, threadReads.userId],
			set: { lastOpenedAt: now, lastReadMessageAt: now }
		});
}

/** Creates a thread and its first message in one shot. */
export async function startThread(
	db: Db,
	store: MediaStore,
	input: {
		partnershipId: string;
		senderId: string;
		icon: ThreadIcon;
		ciphertext: string;
		attachments: OutgoingAttachment[];
	},
	now: Date = new Date()
): Promise<SendResult> {
	const membership = await requireMembership(db, input.partnershipId, input.senderId);
	if (!membership) return { ok: false, reason: 'not-a-member' };

	// Re-validated here as well as in the endpoint's Zod schema. `icon` is the
	// one plaintext column in the feature, and a closed list is only closed if
	// every writer checks it.
	if (!isThreadIcon(input.icon)) return { ok: false, reason: 'bad-icon' };

	const problem = checkPayload(input.ciphertext, input.attachments);
	if (problem) return { ok: false, reason: problem };

	const threadId = crypto.randomUUID();
	const messageId = crypto.randomUUID();
	const attachmentRows = await writeAttachments(
		store,
		input.partnershipId,
		messageId,
		input.attachments
	);

	await db.batch([
		db.insert(messageThreads).values({
			id: threadId,
			partnershipId: input.partnershipId,
			icon: input.icon,
			lastMessageAt: now,
			lastMessageSenderId: input.senderId
		}),
		db.insert(messages).values({
			id: messageId,
			threadId,
			senderId: input.senderId,
			ciphertext: input.ciphertext,
			createdAt: now
		}),
		...attachmentRows.map((row) => db.insert(messageAttachments).values(row)),
		markSenderRead(db, threadId, input.senderId, now)
	]);

	return { ok: true, threadId, messageId };
}

/** A reply to an existing thread. */
export async function sendMessage(
	db: Db,
	store: MediaStore,
	input: {
		partnershipId: string;
		threadId: string;
		senderId: string;
		ciphertext: string;
		attachments: OutgoingAttachment[];
	},
	now: Date = new Date()
): Promise<SendResult> {
	const membership = await requireThreadMembership(
		db,
		input.partnershipId,
		input.threadId,
		input.senderId
	);
	if (!membership) {
		const inPartnership = await requireMembership(db, input.partnershipId, input.senderId);
		return { ok: false, reason: inPartnership ? 'no-such-thread' : 'not-a-member' };
	}

	const problem = checkPayload(input.ciphertext, input.attachments);
	if (problem) return { ok: false, reason: problem };

	const messageId = crypto.randomUUID();
	const attachmentRows = await writeAttachments(
		store,
		input.partnershipId,
		messageId,
		input.attachments
	);

	await db.batch([
		db.insert(messages).values({
			id: messageId,
			threadId: input.threadId,
			senderId: input.senderId,
			ciphertext: input.ciphertext,
			createdAt: now
		}),
		...attachmentRows.map((row) => db.insert(messageAttachments).values(row)),
		db
			.update(messageThreads)
			.set({ lastMessageAt: now, lastMessageSenderId: input.senderId })
			.where(eq(messageThreads.id, input.threadId)),
		markSenderRead(db, input.threadId, input.senderId, now)
	]);

	return { ok: true, threadId: input.threadId, messageId };
}

/**
 * Records that the viewer opened a thread.
 *
 * `lastReadMessageAt` is set to the thread's CURRENT `last_message_at`, read
 * inside the same call — not to `now`. Using `now` would mark a message that
 * arrived in the same second as already read, and it would be silent.
 */
export async function markThreadOpened(
	db: Db,
	threadId: string,
	viewerId: string,
	now: Date = new Date()
): Promise<void> {
	const rows = await db
		.select({ lastMessageAt: messageThreads.lastMessageAt })
		.from(messageThreads)
		.where(eq(messageThreads.id, threadId))
		.limit(1);

	const row = rows[0];
	if (!row) return;

	await db
		.insert(threadReads)
		.values({
			threadId,
			userId: viewerId,
			lastOpenedAt: now,
			lastReadMessageAt: row.lastMessageAt
		})
		.onConflictDoUpdate({
			target: [threadReads.threadId, threadReads.userId],
			set: { lastOpenedAt: now, lastReadMessageAt: row.lastMessageAt }
		});
}

export type ReactionResult =
	{ ok: true } | { ok: false; reason: 'not-a-member' | 'own-message' | 'too-large' };

/**
 * Sets or replaces the viewer's reaction to a message.
 *
 * Refuses on the viewer's own message: the requirement is reacting to messages
 * you have *received*, and a unique index cannot express "not mine" because
 * SQLite's CHECK constraints cannot see another table.
 */
export async function setReaction(
	db: Db,
	input: { partnershipId: string; messageId: string; viewerId: string; ciphertext: string }
): Promise<ReactionResult> {
	const membership = await requireMessageMembership(
		db,
		input.partnershipId,
		input.messageId,
		input.viewerId
	);
	if (!membership) return { ok: false, reason: 'not-a-member' };
	if (membership.senderId === input.viewerId) return { ok: false, reason: 'own-message' };
	if (input.ciphertext.length === 0 || input.ciphertext.length > MAX_REACTION_CIPHERTEXT_BYTES) {
		return { ok: false, reason: 'too-large' };
	}

	await db
		.insert(messageReactions)
		.values({
			messageId: input.messageId,
			userId: input.viewerId,
			ciphertext: input.ciphertext
		})
		.onConflictDoUpdate({
			target: [messageReactions.messageId, messageReactions.userId],
			set: { ciphertext: input.ciphertext, updatedAt: new Date() }
		});

	return { ok: true };
}

export async function clearReaction(
	db: Db,
	input: { partnershipId: string; messageId: string; viewerId: string }
): Promise<ReactionResult> {
	const membership = await requireMessageMembership(
		db,
		input.partnershipId,
		input.messageId,
		input.viewerId
	);
	if (!membership) return { ok: false, reason: 'not-a-member' };

	await db
		.delete(messageReactions)
		.where(
			and(
				eq(messageReactions.messageId, input.messageId),
				eq(messageReactions.userId, input.viewerId)
			)
		);

	return { ok: true };
}

// ── history restore ──────────────────────────────────────────────────────────

/**
 * Opens a request for the partner to re-encrypt the shared history.
 *
 * Any earlier pending request from the same person is superseded, so a second
 * attempt does not leave the partner with two prompts and no way to tell which
 * recipient is current.
 */
export async function requestHistoryRestore(
	db: Db,
	input: { partnershipId: string; requesterId: string; recipient: string },
	now: Date = new Date()
): Promise<{ ok: true; id: string } | { ok: false; reason: 'not-a-member' }> {
	const membership = await requireMembership(db, input.partnershipId, input.requesterId);
	if (!membership) return { ok: false, reason: 'not-a-member' };

	const id = crypto.randomUUID();
	await db.batch([
		db
			.update(historyRestoreRequests)
			.set({ status: 'declined', resolvedAt: now })
			.where(
				and(
					eq(historyRestoreRequests.partnershipId, input.partnershipId),
					eq(historyRestoreRequests.requesterId, input.requesterId),
					eq(historyRestoreRequests.status, 'pending')
				)
			),
		db.insert(historyRestoreRequests).values({
			id,
			partnershipId: input.partnershipId,
			requesterId: input.requesterId,
			requestedRecipient: input.recipient
		})
	]);

	return { ok: true, id };
}

/** Any open restore request in this partnership, from either side. */
export async function listRestoreRequests(
	db: Db,
	partnershipId: string,
	viewerId: string
): Promise<RestoreRequestView[]> {
	const rows = await db
		.select({
			id: historyRestoreRequests.id,
			requesterId: historyRestoreRequests.requesterId,
			requestedRecipient: historyRestoreRequests.requestedRecipient,
			createdAt: historyRestoreRequests.createdAt
		})
		.from(historyRestoreRequests)
		.where(
			and(
				eq(historyRestoreRequests.partnershipId, partnershipId),
				eq(historyRestoreRequests.status, 'pending')
			)
		)
		.orderBy(desc(historyRestoreRequests.createdAt));

	return rows.map((row) => ({
		id: row.id,
		requestedRecipient: row.requestedRecipient,
		createdAt: row.createdAt,
		mine: row.requesterId === viewerId
	}));
}

/**
 * Replaces message bodies with copies re-encrypted to the requester's new key.
 *
 * Only the *bodies* — attachments in the object store are never touched,
 * because each file is encrypted under its own ephemeral identity carried
 * inside the body. Re-encrypting a few kilobytes per message therefore restores
 * access to gigabytes of media.
 *
 * The server cannot verify that the new ciphertext says what the old one said;
 * it cannot read either. That is not a new trust boundary — the partner doing
 * the restore could always send whatever they liked — but it is written down in
 * docs/messaging.md rather than left implied.
 */
export async function applyHistoryRestore(
	db: Db,
	input: {
		partnershipId: string;
		requestId: string;
		/** The partner doing the re-encryption, not the one who lost their key. */
		actorId: string;
		messages: { id: string; ciphertext: string }[];
		/** True on the final page, which closes the request. */
		final: boolean;
	},
	now: Date = new Date()
): Promise<
	{ ok: true; updated: number } | { ok: false; reason: 'not-a-member' | 'no-such-request' }
> {
	const membership = await requireMembership(db, input.partnershipId, input.actorId);
	if (!membership) return { ok: false, reason: 'not-a-member' };

	const requests = await db
		.select({ id: historyRestoreRequests.id, requesterId: historyRestoreRequests.requesterId })
		.from(historyRestoreRequests)
		.where(
			and(
				eq(historyRestoreRequests.id, input.requestId),
				eq(historyRestoreRequests.partnershipId, input.partnershipId),
				eq(historyRestoreRequests.status, 'pending')
			)
		)
		.limit(1);

	const request = requests[0];
	// The actor must be the OTHER member: the person who lost their key cannot
	// re-encrypt anything, since they cannot read it.
	if (!request || request.requesterId === input.actorId) {
		return { ok: false, reason: 'no-such-request' };
	}

	const oversized = input.messages.some(
		(message) => message.ciphertext.length === 0 || message.ciphertext.length > MAX_CIPHERTEXT_BYTES
	);
	if (oversized) return { ok: false, reason: 'no-such-request' };

	const updates = input.messages.map((message) =>
		db
			.update(messages)
			.set({ ciphertext: message.ciphertext })
			// Scoped through the thread to this partnership, so a request cannot be
			// used to rewrite a message belonging to somebody else's conversation.
			.where(
				and(
					eq(messages.id, message.id),
					inArray(
						messages.threadId,
						db
							.select({ id: messageThreads.id })
							.from(messageThreads)
							.where(eq(messageThreads.partnershipId, input.partnershipId))
					)
				)
			)
	);

	const closing = input.final
		? [
				db
					.update(historyRestoreRequests)
					.set({ status: 'completed', resolvedAt: now })
					.where(eq(historyRestoreRequests.id, input.requestId))
			]
		: [];

	const statements = [...updates, ...closing];
	if (statements.length > 0) {
		await db.batch(statements as [(typeof statements)[number], ...typeof statements]);
	}

	return { ok: true, updated: input.messages.length };
}

/** Marks a restore request refused, so the requester is told rather than left waiting. */
export async function declineHistoryRestore(
	db: Db,
	input: { partnershipId: string; requestId: string; actorId: string },
	now: Date = new Date()
): Promise<boolean> {
	const membership = await requireMembership(db, input.partnershipId, input.actorId);
	if (!membership) return false;

	const rows = await db
		.update(historyRestoreRequests)
		.set({ status: 'declined', resolvedAt: now })
		.where(
			and(
				eq(historyRestoreRequests.id, input.requestId),
				eq(historyRestoreRequests.partnershipId, input.partnershipId),
				eq(historyRestoreRequests.status, 'pending'),
				ne(historyRestoreRequests.requesterId, input.actorId)
			)
		)
		.returning({ id: historyRestoreRequests.id });

	return rows.length > 0;
}

// ── teardown ─────────────────────────────────────────────────────────────────

/**
 * Deletes every stored object for a partnership.
 *
 * Nothing cascades from D1 into the object store, so this has to be called
 * when a partnership is disconnected. It deletes by prefix rather than by
 * enumerating rows, which means it still works after the rows have gone — the
 * escape hatch if it ever fails midway.
 *
 * Failure is reported, not thrown: leaving an unreadable blob behind is a much
 * smaller problem than refusing to let someone disconnect, which
 * docs/partners.md is explicit must never be gated.
 */
export async function purgePartnershipMedia(
	store: MediaStore,
	partnershipId: string
): Promise<{ deleted: number; failed: boolean }> {
	try {
		return {
			deleted: await store.deletePrefix(partnershipMediaPrefix(partnershipId)),
			failed: false
		};
	} catch {
		return { deleted: 0, failed: true };
	}
}
