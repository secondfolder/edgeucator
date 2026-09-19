/**
 * The messaging domain rules, shared by server code and components.
 *
 * Deliberately alias-free (relative imports only) for the same reason as
 * `src/lib/partnership.ts`: the Drizzle schema imports `ThreadIcon` from here,
 * and drizzle-kit loads the schema outside Vite, where `$lib` does not resolve.
 *
 * Nothing in here touches the database or does any cryptography. "Is this
 * thread unread?" and "what order do the stickers go in?" are pure functions of
 * a row plus a viewer id, so they can be answered identically in SQL's
 * predicate, in a server test, and in a component.
 */

/**
 * The sticker set. A closed list, and that is the load-bearing part.
 *
 * `message_threads.icon` is the one plaintext column in this feature — the
 * board has to render before any key is unlocked, because it is the screen you
 * look at to decide what to open. What that leaks is about four bits from this
 * fixed list, next to timestamps, sender ids and exact ciphertext byte sizes
 * the server cannot avoid knowing.
 *
 * A free-text plaintext column here would instead be a covert channel for
 * arbitrary prose, which is why every write path validates against this list
 * rather than trusting the one before it.
 *
 * All sixteen are Font Awesome classic-solid names in the free tier bundled
 * with Web Awesome 3.12 (FA 7.3.0), checked against the CDN — Pro-only names
 * render as nothing at all, with no error.
 */
export const THREAD_ICONS = [
	'envelope',
	'envelope-open-text',
	'bottle-droplet',
	'scroll',
	'note-sticky',
	'paper-plane',
	'heart',
	'fire',
	'pepper-hot',
	'gem',
	'key',
	'mask',
	'ghost',
	'gift',
	'cake-candles',
	'feather'
] as const;

export type ThreadIcon = (typeof THREAD_ICONS)[number];

/**
 * A human name for each sticker.
 *
 * Needed, not decorative: the picker is a set of radios whose only visible
 * content is an icon, and Font Awesome names like `bottle-droplet` are not
 * something to read out to anyone. These are the accessible names, and they are
 * also what a test locator matches on.
 */
export const THREAD_ICON_LABELS: Record<ThreadIcon, string> = {
	envelope: 'Sealed envelope',
	'envelope-open-text': 'Open letter',
	'bottle-droplet': 'Message in a bottle',
	scroll: 'Scroll',
	'note-sticky': 'Sticky note',
	'paper-plane': 'Paper plane',
	heart: 'Heart',
	fire: 'Flame',
	'pepper-hot': 'Chilli pepper',
	gem: 'Gem',
	key: 'Key',
	mask: 'Mask',
	ghost: 'Ghost',
	gift: 'Gift',
	'cake-candles': 'Birthday cake',
	feather: 'Feather'
};

/** The icon a thread gets when the sender does not pick one. */
export const DEFAULT_THREAD_ICON: ThreadIcon = 'envelope';

/**
 * LEGACY-RICHTEXT — how a message body is serialised.
 *
 * Plaintext, and a closed list of exactly two values, for the same reason the
 * thread icon is (AGENTS.md invariant 14): the server cannot read a body, so
 * without this it cannot tell a pre-rich-text message from a converted one.
 * Two fixed values reveal nothing about content, where a free-text column
 * would be a covert channel. Re-validated in `server/messaging.ts` as well as
 * in the endpoint's Zod schema.
 *
 * It earns its place three times over:
 *
 * 1. The migration endpoint accepts a rewrite only for a row still at
 *    `'plain'`, so it cannot become a general "edit any message I sent"
 *    backdoor — messages are otherwise immutable by design.
 * 2. `select count(*) from messages where body_format = 'plain'` is the
 *    removal trigger for all the legacy code, rather than a guess.
 * 3. The client knows which messages are worth converting without decrypting
 *    every one first.
 *
 * Deleted with the rest of the legacy handling; see docs/temporary-code.md.
 */
export const MESSAGE_BODY_FORMATS = ['plain', 'lexical'] as const;

export type MessageBodyFormat = (typeof MESSAGE_BODY_FORMATS)[number];

export function isMessageBodyFormat(value: unknown): value is MessageBodyFormat {
	return typeof value === 'string' && (MESSAGE_BODY_FORMATS as readonly string[]).includes(value);
}

export function isThreadIcon(value: unknown): value is ThreadIcon {
	return typeof value === 'string' && (THREAD_ICONS as readonly string[]).includes(value);
}

/**
 * Where a partner-assisted history restore has got to.
 *
 * `declined` is kept rather than deleting the row so that a requester is told
 * "they said no" instead of the request appearing to vanish, and so a second
 * request is a deliberate act rather than an accident.
 */
export type RestoreRequestStatus = 'pending' | 'completed' | 'declined';

// ── caps ─────────────────────────────────────────────────────────────────────

/**
 * Total encrypted attachment bytes in one message.
 *
 * `request.formData()` buffers the whole body, and a Worker isolate has 128 MB,
 * so this is a memory budget rather than a product decision: 25 MB leaves room
 * for two concurrent uploads in one isolate and not three. The Workers request
 * body limit (100 MB on Free and Pro) is well above it.
 */
export const MAX_ATTACHMENT_TOTAL_BYTES = 25 * 1024 * 1024;

/** Per message, so one enormous file cannot be split past the total either. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 6;

/**
 * Lower than the total, deliberately.
 *
 * age ciphertext is not seekable, so there is no `Range` support and no
 * progressive playback: a video is downloaded in full and decrypted in memory
 * before it can play. 15 MB is about as long as that stays tolerable on a
 * phone.
 */
export const MAX_VIDEO_BYTES = 15 * 1024 * 1024;

/**
 * Ciphertext ceiling for a message body.
 *
 * D1's per-value limit is 2,000,000 bytes, so this is not near it. The point is
 * to bound what one row can cost to read, since D1 bills on bytes.
 */
export const MAX_CIPHERTEXT_BYTES = 64 * 1024;

/** A reaction is an emoji, so its ciphertext has no business being large. */
export const MAX_REACTION_CIPHERTEXT_BYTES = 4 * 1024;

/** Plaintext characters in a message body, enforced client-side before encrypting. */
export const MAX_BODY_CHARS = 4000;

/** Threads per board before paging would be needed. */
export const BOARD_LIMIT = 200;

/**
 * Reactions one message can carry.
 *
 * Two, and this is a fact about the domain rather than a policy: a reaction is
 * unique per `(message, user)` and a partnership has exactly two members. Used
 * to bound the restore payload.
 */
export const MAX_REACTIONS_PER_MESSAGE = 2;

/**
 * Messages per page of a partner-assisted history restore.
 *
 * Lives here, in the pure module, rather than beside the query that uses it,
 * because the endpoint's Zod schema needs it too — a client must not be able
 * to post back more rows than a page could have contained. Bounded because the
 * whole page is decrypted and re-encrypted in the browser, and because D1
 * bills on bytes read: 100 bodies at the 64 KB cap is a 6 MB worst case, which
 * is a lot but not a hang. In practice a sext is a few hundred bytes.
 */
export const RESTORE_PAGE_SIZE = 100;

// ── unread ───────────────────────────────────────────────────────────────────

export type ThreadUnreadInput = {
	lastMessageAt: Date;
	lastMessageSenderId: string;
	lastReadMessageAt: Date | null;
};

/**
 * The single definition of "unread", shared by the SQL predicate in
 * `server/messaging.ts` and by anything that needs to re-check it in JS.
 *
 * Note what makes the sender test sufficient: `sendMessage` upserts the
 * sender's own `thread_reads` row inside the same `db.batch()` as the message,
 * so "the newest message is mine" really does imply "I have read this thread".
 * That is enforced on the server, not by the composer only being reachable from
 * an opened thread.
 *
 * The comparison is `>` rather than `>=` so that a thread whose read mark
 * equals its newest message counts as read — otherwise reopening a thread you
 * just read would flicker back to unread.
 */
export function isUnreadFor(thread: ThreadUnreadInput, viewerId: string): boolean {
	if (thread.lastMessageSenderId === viewerId) return false;
	if (thread.lastReadMessageAt === null) return true;
	return thread.lastMessageAt.getTime() > thread.lastReadMessageAt.getTime();
}

// ── board ordering ───────────────────────────────────────────────────────────

export type BoardThread = {
	id: string;
	unread: boolean;
	lastMessageAt: Date;
	/** Null for a thread this viewer has never read up to its current latest message. */
	lastFullyReadAt: Date | null;
};

/**
 * The board order: unread first with the newest at the top, then the read ones,
 * by when the current latest message was first read.
 *
 * The two halves sort on different columns, which is why this is one comparator
 * rather than a single key — and why the SQL version needs a CASE expression.
 * This exists mainly so that order is testable without a database; the query is
 * the thing that actually runs.
 *
 * A read thread with no `lastFullyReadAt` cannot happen by construction (a thread
 * is only read because a `thread_reads` row exists), but it sorts last rather
 * than throwing: an ordering function is the wrong place to discover a data
 * problem.
 */
export function compareBoardThreads(a: BoardThread, b: BoardThread): number {
	if (a.unread !== b.unread) return a.unread ? -1 : 1;

	if (a.unread) {
		const byRecency = b.lastMessageAt.getTime() - a.lastMessageAt.getTime();
		if (byRecency !== 0) return byRecency;
	} else {
		const aOpened = a.lastFullyReadAt?.getTime() ?? -Infinity;
		const bOpened = b.lastFullyReadAt?.getTime() ?? -Infinity;
		if (aOpened !== bOpened) return bOpened - aOpened;
	}

	// UUIDs, so this is only ever a tiebreak for two rows that genuinely share a
	// millisecond — never a meaningful order in itself. See AGENTS.md invariant 8.
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
