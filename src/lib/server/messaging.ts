import { and, asc, desc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import type { Db } from './db';
import {
	historyRestoreRequests,
	messageAttachments,
	messageReactions,
	messageTags,
	messageThreadTags,
	messageThreads,
	messages,
	partnerships,
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
	RESTORE_PAGE_SIZE,
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
import type { PartnerView, TagView } from '../types';

/** Whether message-key settings are relevant for this user yet. */
export async function userHasMessageHistory(db: Db, userId: string): Promise<boolean> {
	const rows = await db
		.select({ id: messageThreads.id })
		.from(messageThreads)
		.innerJoin(partnerships, eq(partnerships.id, messageThreads.partnershipId))
		.where(or(eq(partnerships.inviterId, userId), eq(partnerships.inviteeId, userId)))
		.limit(1);

	return rows.length > 0;
}

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
 * channel (AGENTS.md invariant 14).
 */

// ── column lists ─────────────────────────────────────────────────────────────

/** Only what a sticker needs. D1 bills on bytes read, and `ciphertext` is big. */
const threadStickerColumns = {
	id: messageThreads.id,
	icon: messageThreads.icon,
	lastMessageAt: messageThreads.lastMessageAt,
	lastMessageSenderId: messageThreads.lastMessageSenderId,
	lastFullyReadAt: threadReads.lastFullyReadAt,
	lastReadMessageAt: threadReads.lastReadMessageAt
} as const;

const messageColumns = {
	id: messages.id,
	senderId: messages.senderId,
	ciphertext: messages.ciphertext,
	// LEGACY-RICHTEXT: lets the client find its own un-migrated messages without
	// decrypting every one first.
	bodyFormat: messages.bodyFormat,
	metadataCiphertext: messages.metadataCiphertext,
	createdAt: messages.createdAt
} as const;

const previewCiphertext = sql<string>`(
	select ${messages.ciphertext}
	from ${messages}
	where ${messages.threadId} = ${messageThreads.id}
	order by ${messages.createdAt} asc, ${messages.id} asc
	limit 1
)`;

const previewMetadataCiphertext = sql<string | null>`(
	select ${messages.metadataCiphertext}
	from ${messages}
	where ${messages.threadId} = ${messageThreads.id}
	order by ${messages.createdAt} asc, ${messages.id} asc
	limit 1
)`;

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
 * `messages` is still not scanned to build recency or unread state; the one
 * correlated read here is only the first ciphertext for the preview tile.
 * The hot-path ordering still comes entirely from the denormalised columns on
 * `message_threads`.
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
		.select({
			...threadStickerColumns,
			unread,
			messageCount,
			previewCiphertext,
			previewMetadataCiphertext
		})
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
			// Requirement: unread first by newest message, then read by when that
			// current latest message was first read. The CASE is what lets the two
			// halves sort on different columns without a second round trip.
			desc(unread),
			desc(sql`case when ${unread} then ${messageThreads.lastMessageAt}
			              else ${threadReads.lastFullyReadAt} end`),
			asc(messageThreads.id)
		)
		.limit(BOARD_LIMIT);
	const threadIds = rows.map((row) => row.id);
	const tagRows = threadIds.length
		? await db
				.select({
					threadId: messageThreadTags.threadId,
					id: messageTags.id,
					name: messageTags.name,
					color: messageTags.color
				})
				.from(messageThreadTags)
				.innerJoin(messageTags, eq(messageTags.id, messageThreadTags.tagId))
				.where(inArray(messageThreadTags.threadId, threadIds))
				.orderBy(asc(messageTags.createdAt), asc(messageTags.id))
		: [];
	const tagsByThread = new Map<string, TagView[]>();
	for (const tag of tagRows) {
		const values = tagsByThread.get(tag.threadId) ?? [];
		values.push({ id: tag.id, name: tag.name, color: tag.color });
		tagsByThread.set(tag.threadId, values);
	}

	return rows.map((row) => ({
		id: row.id,
		icon: row.icon,
		tags: tagsByThread.get(row.id) ?? [],
		// SQLite has no boolean, so this arrives as 0/1. Normalised here so no
		// component ever receives a number pretending to be a flag.
		unread: Boolean(row.unread),
		lastMessageAt: row.lastMessageAt,
		lastFullyReadAt: row.lastFullyReadAt ?? null,
		messageCount: Number(row.messageCount),
		previewCiphertext: row.previewCiphertext,
		previewMetadataCiphertext: row.previewMetadataCiphertext ?? null
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
	const [attachments, reactions, tags] = await Promise.all([
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
			: [],
		db
			.select({ id: messageTags.id, name: messageTags.name, color: messageTags.color })
			.from(messageThreadTags)
			.innerJoin(messageTags, eq(messageTags.id, messageThreadTags.tagId))
			.where(eq(messageThreadTags.threadId, threadId))
			.orderBy(asc(messageTags.createdAt), asc(messageTags.id))
	]);

	const byMessage = new Map<string, MessageView>();
	const view: ThreadView = {
		id: threadId,
		icon,
		tags: tags.map((tag) => ({ id: tag.id, name: tag.name, color: tag.color })),
		messages: rows.map((row) => {
			const message: MessageView = {
				id: row.id,
				// Resolved here so no component sees a user id, which keeps the
				// "never return locals.user wholesale" posture intact.
				mine: row.senderId === viewerId,
				ciphertext: row.ciphertext,
				bodyFormat: row.bodyFormat,
				metadataCiphertext: row.metadataCiphertext ?? null,
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
	| 'no-such-tag'
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
 * reachable from an opened thread (invariant 14).
 */
function markSenderRead(db: Db, threadId: string, senderId: string, now: Date) {
	// `timestamp_ms` column mode maps a Date for the `values()` half of this
	// statement, but NOT inside a hand-written `sql` fragment — there Drizzle
	// binds whatever it is given as-is, and D1 rejects Date objects with
	// D1_TYPE_ERROR (libsql, used in dev and tests, accepts them, so only the
	// real Workers runtime catches it). Bind the epoch millis the columns
	// actually store.
	const nowMs = now.getTime();
	return db
		.insert(threadReads)
		.values({ threadId, userId: senderId, lastFullyReadAt: now, lastReadMessageAt: now })
		.onConflictDoUpdate({
			target: [threadReads.threadId, threadReads.userId],
			set: {
				lastFullyReadAt: sql`case
					when ${threadReads.lastReadMessageAt} is null
					  or ${threadReads.lastReadMessageAt} < ${nowMs}
					then ${nowMs}
					else ${threadReads.lastFullyReadAt}
				end`,
				lastReadMessageAt: now
			}
		});
}

const TAG_COLORS = ['#d95f59', '#d98c3f', '#c5a33d', '#55a36b', '#3f9caa', '#5d7fc2', '#8b67b5'];

function validTagName(name: string): string | null {
	const value = name.trim();
	return value.length > 0 && value.length <= 80 ? value : null;
}

function validTagColor(color: string): boolean {
	return /^#[0-9a-f]{6}$/i.test(color);
}

async function tagRowsForPartnership(db: Db, partnershipId: string, tagIds: string[]) {
	const uniqueIds = [...new Set(tagIds)];
	if (uniqueIds.length === 0) return [];
	const rows = await db
		.select({ id: messageTags.id })
		.from(messageTags)
		.where(and(eq(messageTags.partnershipId, partnershipId), inArray(messageTags.id, uniqueIds)));
	return rows.length === uniqueIds.length ? rows : null;
}

export async function listTags(
	db: Db,
	partnershipId: string,
	userId: string
): Promise<TagView[] | null> {
	if (!(await requireMembership(db, partnershipId, userId))) return null;
	return db
		.select({ id: messageTags.id, name: messageTags.name, color: messageTags.color })
		.from(messageTags)
		.where(eq(messageTags.partnershipId, partnershipId))
		.orderBy(asc(messageTags.name), asc(messageTags.id));
}

export type TagMutationResult =
	| { ok: true; tag: TagView }
	| {
			ok: false;
			reason: 'not-a-member' | 'invalid-name' | 'invalid-color' | 'duplicate-name' | 'no-such-tag';
	  };

export async function createTag(
	db: Db,
	partnershipId: string,
	userId: string,
	name: string,
	color?: string
): Promise<TagMutationResult> {
	if (!(await requireMembership(db, partnershipId, userId)))
		return { ok: false, reason: 'not-a-member' };
	const validName = validTagName(name);
	if (!validName) return { ok: false, reason: 'invalid-name' };
	const existing = await db
		.select({ id: messageTags.id })
		.from(messageTags)
		.where(and(eq(messageTags.partnershipId, partnershipId), eq(messageTags.name, validName)))
		.limit(1);
	if (existing[0]) return { ok: false, reason: 'duplicate-name' };
	// A chosen colour wins; anything malformed falls back to the random pick
	// rather than refusing, so the picker's default never blocks creation.
	const chosen = color !== undefined && validTagColor(color) ? color : null;
	const tag = {
		id: crypto.randomUUID(),
		partnershipId,
		name: validName,
		color: chosen ?? TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)] ?? TAG_COLORS[0]
	};
	await db.insert(messageTags).values(tag);
	return { ok: true, tag: { id: tag.id, name: tag.name, color: tag.color } };
}

export async function updateTag(
	db: Db,
	partnershipId: string,
	userId: string,
	tagId: string,
	input: { name?: string; color?: string }
): Promise<TagMutationResult> {
	if (!(await requireMembership(db, partnershipId, userId)))
		return { ok: false, reason: 'not-a-member' };
	const current = await db
		.select({ id: messageTags.id, name: messageTags.name, color: messageTags.color })
		.from(messageTags)
		.where(and(eq(messageTags.id, tagId), eq(messageTags.partnershipId, partnershipId)))
		.limit(1);
	if (!current[0]) return { ok: false, reason: 'no-such-tag' };
	const name = input.name === undefined ? current[0].name : validTagName(input.name);
	const color = input.color ?? current[0].color;
	if (!name) return { ok: false, reason: 'invalid-name' };
	if (!validTagColor(color)) return { ok: false, reason: 'invalid-color' };
	const duplicate = await db
		.select({ id: messageTags.id })
		.from(messageTags)
		.where(
			and(
				eq(messageTags.partnershipId, partnershipId),
				eq(messageTags.name, name),
				ne(messageTags.id, tagId)
			)
		)
		.limit(1);
	if (duplicate[0]) return { ok: false, reason: 'duplicate-name' };
	await db.update(messageTags).set({ name, color }).where(eq(messageTags.id, tagId));
	return { ok: true, tag: { id: tagId, name, color } };
}

export async function setThreadTags(
	db: Db,
	partnershipId: string,
	userId: string,
	threadId: string,
	tagIds: string[]
): Promise<
	{ ok: true } | { ok: false; reason: 'not-a-member' | 'no-such-thread' | 'no-such-tag' }
> {
	const membership = await requireThreadMembership(db, partnershipId, threadId, userId);
	if (!membership) return { ok: false, reason: 'no-such-thread' };
	const tags = await tagRowsForPartnership(db, partnershipId, tagIds);
	if (!tags) return { ok: false, reason: 'no-such-tag' };
	await db.batch([
		db.delete(messageThreadTags).where(eq(messageThreadTags.threadId, threadId)),
		...tags.map((tag) => db.insert(messageThreadTags).values({ threadId, tagId: tag.id }))
	]);
	return { ok: true };
}

/**
 * Writes a message's encrypted metadata sidecar.
 *
 * The client owns the merge policy — for example, appending one newly revealed
 * embed to an existing metadata payload — and the server only stores opaque
 * ciphertext after proving the caller can see that message.
 */
export async function setMessageMetadataCiphertext(
	db: Db,
	input: {
		partnershipId: string;
		messageId: string;
		viewerId: string;
		metadataCiphertext: string;
	}
): Promise<boolean> {
	const membership = await requireMessageMembership(
		db,
		input.partnershipId,
		input.messageId,
		input.viewerId
	);
	if (!membership) return false;

	await db
		.update(messages)
		.set({ metadataCiphertext: input.metadataCiphertext })
		.where(eq(messages.id, membership.messageId));
	return true;
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
		metadataCiphertext?: string;
		attachments: OutgoingAttachment[];
		tagIds?: string[];
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
	const tags = await tagRowsForPartnership(db, input.partnershipId, input.tagIds ?? []);
	if (!tags) return { ok: false, reason: 'no-such-tag' };

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
			// LEGACY-RICHTEXT: everything sent from now on is a rich-text document.
			bodyFormat: 'lexical',
			metadataCiphertext: input.metadataCiphertext ?? null,
			createdAt: now
		}),
		...attachmentRows.map((row) => db.insert(messageAttachments).values(row)),
		...tags.map((tag) => db.insert(messageThreadTags).values({ threadId, tagId: tag.id })),
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
		metadataCiphertext?: string;
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
			metadataCiphertext: input.metadataCiphertext ?? null,
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
 * Records that the viewer read the thread up to its current latest message.
 *
 * `lastReadMessageAt` is set to the thread's CURRENT `last_message_at`, read
 * inside the same call — not to `now`. Using `now` would mark a message that
 * arrived in the same second as already read, and it would be silent.
 *
 * `lastFullyReadAt` is only advanced when the latest message changes from unread
 * to read. Reopening a thread with no new messages must not reshuffle the
 * board's read section.
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
			lastFullyReadAt: now,
			lastReadMessageAt: row.lastMessageAt
		})
		.onConflictDoUpdate({
			target: [threadReads.threadId, threadReads.userId],
			set: {
				lastFullyReadAt: sql`case
					when ${threadReads.lastReadMessageAt} is null
					  or ${threadReads.lastReadMessageAt} < ${row.lastMessageAt}
					then ${now}
					else ${threadReads.lastFullyReadAt}
				end`,
				lastReadMessageAt: row.lastMessageAt
			}
		});
}

export type ReactionResult =
	/**
	 * `threadId` is returned so the caller can publish a realtime event without
	 * a second lookup — `requireMessageMembership` has already resolved it, so
	 * not returning it would mean re-reading the row to name the thread that
	 * just changed.
	 */
	| { ok: true; threadId: string }
	| { ok: false; reason: 'not-a-member' | 'own-message' | 'too-large' };

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

	return { ok: true, threadId: membership.threadId };
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

	return { ok: true, threadId: membership.threadId };
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

export type RestorePage = {
	messages: { id: string; ciphertext: string; metadataCiphertext?: string | null }[];
	/** The reactions on *these* messages, so a page is self-contained. */
	reactions: { id: string; ciphertext: string }[];
	/** Pass back as `cursor` for the next page. Null means this was the last. */
	nextCursor: string | null;
};

/**
 * A page of the shared history, for the partner who is re-encrypting it.
 *
 * Only ever called by the *other* member — the person who lost their key
 * cannot read any of this, which is the whole reason the flow exists. That is
 * checked against the request row rather than assumed from the caller.
 *
 * Ordered by `(created_at, id)` and paged on that same pair rather than on an
 * offset: a keyset cursor cannot skip or repeat a row if anything is written
 * while the restore is in flight, and an OFFSET can do both.
 */
export async function listHistoryForRestore(
	db: Db,
	input: { partnershipId: string; requestId: string; actorId: string; cursor?: string | null }
): Promise<RestorePage | null> {
	const request = await findRestorableRequest(db, input);
	if (!request) return null;

	const after = parseRestoreCursor(input.cursor);

	const rows = await db
		.select({
			id: messages.id,
			ciphertext: messages.ciphertext,
			metadataCiphertext: messages.metadataCiphertext,
			createdAt: messages.createdAt
		})
		.from(messages)
		.where(
			and(
				inArray(
					messages.threadId,
					db
						.select({ id: messageThreads.id })
						.from(messageThreads)
						.where(eq(messageThreads.partnershipId, input.partnershipId))
				),
				// The keyset predicate: strictly after (createdAt, id) as a pair.
				after
					? sql`(${messages.createdAt} > ${after.createdAt} or (${messages.createdAt} = ${after.createdAt} and ${messages.id} > ${after.id}))`
					: undefined
			)
		)
		.orderBy(asc(messages.createdAt), asc(messages.id))
		.limit(RESTORE_PAGE_SIZE);

	const ids = rows.map((row) => row.id);
	const reactions = ids.length
		? await db
				.select({ id: messageReactions.id, ciphertext: messageReactions.ciphertext })
				.from(messageReactions)
				.where(inArray(messageReactions.messageId, ids))
		: [];

	const last = rows[rows.length - 1];
	return {
		messages: rows.map((row) => ({
			id: row.id,
			ciphertext: row.ciphertext,
			metadataCiphertext: row.metadataCiphertext ?? null
		})),
		reactions,
		// A short page is the last page. A full page might be exactly the end, in
		// which case the next call returns nothing and stops — one wasted read,
		// versus a count query on every page.
		nextCursor:
			rows.length === RESTORE_PAGE_SIZE && last ? `${last.createdAt.getTime()}:${last.id}` : null
	};
}

/** `<epoch millis>:<uuid>`. Anything else is treated as "start from the beginning". */
function parseRestoreCursor(
	cursor: string | null | undefined
): { createdAt: Date; id: string } | null {
	if (!cursor) return null;
	const separator = cursor.indexOf(':');
	if (separator < 1) return null;
	const millis = Number(cursor.slice(0, separator));
	const id = cursor.slice(separator + 1);
	if (!Number.isSafeInteger(millis) || id.length === 0) return null;
	return { createdAt: new Date(millis), id };
}

/**
 * The pending request, if `actorId` is the member who can actually act on it.
 *
 * Shared by the read and the write so the two cannot disagree about who is
 * allowed — the read hands over the entire shared history, so it needs exactly
 * the same gate as the write.
 */
async function findRestorableRequest(
	db: Db,
	input: { partnershipId: string; requestId: string; actorId: string }
): Promise<{ id: string; requesterId: string } | null> {
	const membership = await requireMembership(db, input.partnershipId, input.actorId);
	if (!membership) return null;

	const rows = await db
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

	const request = rows[0];
	// The actor must be the OTHER member: the person who lost their key cannot
	// re-encrypt anything, since they cannot read it.
	if (!request || request.requesterId === input.actorId) return null;
	return request;
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
		messages: { id: string; ciphertext: string; metadataCiphertext?: string | null }[];
		/**
		 * Reactions re-encrypted alongside the bodies.
		 *
		 * Included because a reaction is encrypted too (see docs/messaging.md on
		 * why, when the thread icon is not), so a restore that skipped them would
		 * hand back a readable history dotted with tapbacks the owner cannot
		 * open. Optional so the existing callers and tests keep working.
		 */
		reactions?: { id: string; ciphertext: string }[];
		/** True on the final page, which closes the request. */
		final: boolean;
	},
	now: Date = new Date()
): Promise<
	{ ok: true; updated: number } | { ok: false; reason: 'not-a-member' | 'no-such-request' }
> {
	const membership = await requireMembership(db, input.partnershipId, input.actorId);
	if (!membership) return { ok: false, reason: 'not-a-member' };

	const request = await findRestorableRequest(db, input);
	if (!request) return { ok: false, reason: 'no-such-request' };

	const reactions = input.reactions ?? [];
	const tooBig = (value: string, cap: number) => value.length === 0 || value.length > cap;
	if (
		input.messages.some((message) => tooBig(message.ciphertext, MAX_CIPHERTEXT_BYTES)) ||
		input.messages.some(
			(message) =>
				message.metadataCiphertext !== undefined &&
				message.metadataCiphertext !== null &&
				tooBig(message.metadataCiphertext, MAX_CIPHERTEXT_BYTES)
		) ||
		reactions.some((reaction) => tooBig(reaction.ciphertext, MAX_REACTION_CIPHERTEXT_BYTES))
	) {
		return { ok: false, reason: 'no-such-request' };
	}

	// Every write is scoped through the thread to this partnership, so a request
	// cannot be used to rewrite something in somebody else's conversation. This
	// is the confused-deputy guard for the restore path.
	const inThisPartnership = db
		.select({ id: messageThreads.id })
		.from(messageThreads)
		.where(eq(messageThreads.partnershipId, input.partnershipId));

	const updates = [
		...input.messages.map((message) =>
			db
				.update(messages)
				.set({
					ciphertext: message.ciphertext,
					...(message.metadataCiphertext === undefined
						? {}
						: { metadataCiphertext: message.metadataCiphertext })
				})
				.where(and(eq(messages.id, message.id), inArray(messages.threadId, inThisPartnership)))
		),
		...reactions.map((reaction) =>
			db
				.update(messageReactions)
				.set({ ciphertext: reaction.ciphertext })
				.where(
					and(
						eq(messageReactions.id, reaction.id),
						// Two levels out: reaction → message → thread → partnership.
						inArray(
							messageReactions.messageId,
							db
								.select({ id: messages.id })
								.from(messages)
								.where(inArray(messages.threadId, inThisPartnership))
						)
					)
				)
		)
	];

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

	return { ok: true, updated: input.messages.length + reactions.length };
}

/**
 * LEGACY-RICHTEXT — replaces a sender's own pre-rich-text bodies with converted
 * ones.
 *
 * Deleted once nothing is left at `body_format = 'plain'`; see
 * docs/temporary-code.md.
 *
 * The `where` clause is the whole security model, and every clause is
 * load-bearing:
 *
 * - `senderId = actorId` — you may rewrite only what you wrote. Partners can
 *   read each other's messages, so without this either side could rewrite the
 *   other's words.
 * - `bodyFormat = 'plain'` — strictly one-way. A row already converted cannot
 *   be touched again, so this can never become a general "edit any message I
 *   sent" endpoint. Messages are immutable by design and this keeps them so.
 * - `threadId in (this partnership)` — the confused-deputy guard, same as
 *   `applyHistoryRestore`.
 *
 * As with a restore, the server cannot check that the new ciphertext says what
 * the old one said; it cannot read either. That is not a new trust boundary —
 * `applyHistoryRestore` already lets a client replace bodies wholesale, and
 * docs/messaging.md records it.
 */
export async function migrateMessageBodies(
	db: Db,
	input: {
		partnershipId: string;
		actorId: string;
		messages: { id: string; ciphertext: string; metadataCiphertext?: string | null }[];
	}
): Promise<{ ok: true; updated: number } | { ok: false; reason: 'not-a-member' | 'too-big' }> {
	const membership = await requireMembership(db, input.partnershipId, input.actorId);
	if (!membership) return { ok: false, reason: 'not-a-member' };

	const tooBig = (value: string) => value.length === 0 || value.length > MAX_CIPHERTEXT_BYTES;
	if (
		input.messages.some(
			(message) =>
				tooBig(message.ciphertext) ||
				(typeof message.metadataCiphertext === 'string' && tooBig(message.metadataCiphertext))
		)
	) {
		return { ok: false, reason: 'too-big' };
	}
	if (input.messages.length === 0) return { ok: true, updated: 0 };

	const inThisPartnership = db
		.select({ id: messageThreads.id })
		.from(messageThreads)
		.where(eq(messageThreads.partnershipId, input.partnershipId));

	const updates = input.messages.map((message) =>
		db
			.update(messages)
			.set({
				ciphertext: message.ciphertext,
				bodyFormat: 'lexical',
				...(message.metadataCiphertext === undefined
					? {}
					: { metadataCiphertext: message.metadataCiphertext })
			})
			.where(
				and(
					eq(messages.id, message.id),
					eq(messages.senderId, input.actorId),
					eq(messages.bodyFormat, 'plain'),
					inArray(messages.threadId, inThisPartnership)
				)
			)
	);
	await db.batch(updates as [(typeof updates)[number], ...typeof updates]);

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
