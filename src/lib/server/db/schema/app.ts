import { relations, sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { EdgeTaskInstructions, TaskSchedule } from '../../../types';
import type { PartnershipControl, PartnershipStatus } from '../../../partnership';
import type { KeyWrapParams, KeyWrapType } from '../../../encryption';
import type { MessageBodyFormat, RestoreRequestStatus, ThreadIcon } from '../../../messaging';
import { user } from './auth';

/**
 * Timestamp columns.
 *
 * `mode: 'timestamp_ms'` stores unix *milliseconds* and maps to `Date` in JS.
 * This deliberately matches what the Better Auth CLI generates for SQLite, so
 * both halves of the schema round-trip `Date` identically — a mismatch here
 * would make every date in one half 1000x off.
 *
 * The default is expressed in SQL rather than with `$defaultFn` so that raw
 * `wrangler d1 execute --command "INSERT ..."` also produces valid rows. The
 * expression is copied verbatim from what the Better Auth CLI emits, so the two
 * schema files agree down to the default.
 */
const timestamps = {
	createdAt: integer('created_at', { mode: 'timestamp_ms' })
		.notNull()
		.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
		.notNull()
		.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
		.$onUpdate(() => new Date())
};

export const guides = sqliteTable('guides', {
	// Text ids to match Better Auth's own tables, so any future foreign key
	// between app data and `user.id` is type-consistent. `crypto.randomUUID` is
	// a global in workerd and in Node >= 19, so this needs no dependency.
	// NOTE: this default is JS-side only, so raw SQL inserts must supply `id`.
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	title: text('title').notNull(),
	...timestamps
});

export const edgeTasks = sqliteTable(
	'edge_tasks',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		guideId: text('guide_id')
			.notNull()
			.references(() => guides.id, { onDelete: 'cascade' }),
		/** Sequence position within the guide. Order by this, never by `id`. */
		order: integer('order').notNull().default(0),
		// SQLite has no JSON type. `mode: 'json'` handles parse/stringify and
		// `$type` gives the shape real end-to-end typing.
		instructions: text('instructions', { mode: 'json' }).$type<EdgeTaskInstructions>().notNull(),
		...timestamps
	},
	(table) => [
		// The /home/guides/[id] load's hot path: where guide_id = ? order by "order".
		index('edge_tasks_guide_id_order_idx').on(table.guideId, table.order)
	]
);

export const guidesRelations = relations(guides, ({ many }) => ({
	edgeTasks: many(edgeTasks)
}));

export const edgeTasksRelations = relations(edgeTasks, ({ one }) => ({
	guide: one(guides, {
		fields: [edgeTasks.guideId],
		references: [guides.id]
	})
}));

export type Guide = typeof guides.$inferSelect;
export type NewGuide = typeof guides.$inferInsert;
export type EdgeTask = typeof edgeTasks.$inferSelect;
export type NewEdgeTask = typeof edgeTasks.$inferInsert;

/**
 * A link between two accounts.
 *
 * One row per link, not one per direction: the two labels and the single
 * control setting are properties of the *relationship*, so storing them twice
 * would create two rows that can silently disagree. Everything a screen needs
 * per-viewer is derived at read time by `viewPartnership()` in
 * `src/lib/partnership.ts`.
 *
 * `inviterId`/`inviteeId` keep their meaning after acceptance — they are not
 * just plumbing for the invite. `control` is stored relative to those roles
 * ('inviter' = the person who sent the invite is in control) precisely because
 * the roles are permanent, so a row read from either side means the same thing.
 */
export const partnerships = sqliteTable(
	'partnerships',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		/** Who sent the invite. Never changes. */
		inviterId: text('inviter_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		/** Who accepted it. NULL exactly while `status` is 'pending'. */
		inviteeId: text('invitee_id').references(() => user.id, { onDelete: 'cascade' }),
		status: text('status').$type<PartnershipStatus>().notNull().default('pending'),
		/** The name shown FOR the inviter — i.e. "what do they call you?". */
		inviterName: text('inviter_name').notNull(),
		/** The name shown FOR the invitee — i.e. "What's their name/title?". */
		inviteeName: text('invitee_name').notNull(),
		/** The inviter's role in the connection ("dom", "coach"). Optional. */
		inviterRole: text('inviter_role'),
		/** The invitee's role in the connection ("sub", "trainee"). Optional. */
		inviteeRole: text('invitee_role'),
		control: text('control').$type<PartnershipControl>().notNull(),
		/**
		 * The secret in the invite URL, stored in the clear rather than hashed.
		 *
		 * Hashing would mean the inviter could never be shown the link again, and
		 * re-copying an already-sent link is a requirement. Better Auth stores
		 * `session.token` the same way, so this adds no capability an attacker
		 * with read access to the database would not already have. Cleared on
		 * accept so a consumed link cannot be replayed.
		 */
		inviteToken: text('invite_token').unique(),
		inviteExpiresAt: integer('invite_expires_at', { mode: 'timestamp_ms' }),
		acceptedAt: integer('accepted_at', { mode: 'timestamp_ms' }),
		...timestamps
	},
	(table) => [
		// The bottom nav queries "every accepted partnership I am in" on every
		// page in the app shell, from either side, hence one index per side.
		index('partnerships_inviter_id_idx').on(table.inviterId),
		index('partnerships_invitee_id_idx').on(table.inviteeId)
	]
);

// No `relations()` for partnerships on purpose. Two foreign keys point at the
// same table, which drizzle's relational query API can only disambiguate with a
// `relationName` declared on BOTH sides — and the `user` side lives in the
// generated `schema/auth.ts`, where an edit would be lost on the next
// `npm run auth:schema`. Partner rows are read with explicit aliased joins
// instead; see `src/lib/server/partnerships.ts`.

export type Partnership = typeof partnerships.$inferSelect;
export type NewPartnership = typeof partnerships.$inferInsert;

/**
 * A reward a user can assign and redeem for themselves.
 *
 * Kept separate from partnership rewards because the permission model is not
 * the same: self rewards are always managed and claimed by the owner, while
 * partnership rewards are managed by control and claimed against authorship.
 * A single polymorphic table would push those differences into nullable scope
 * columns and case-heavy queries on every read path.
 */
export const selfRewards = sqliteTable(
	'self_rewards',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		ownerId: text('owner_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		description: text('description'),
		cost: integer('cost').notNull(),
		active: integer('active', { mode: 'boolean' }).notNull().default(true),
		...timestamps
	},
	(table) => [
		index('self_rewards_owner_active_idx').on(table.ownerId, table.active),
		index('self_rewards_owner_created_idx').on(table.ownerId, table.createdAt)
	]
);

/** One credit balance per user for their own self-reward pool. */
export const selfRewardCredits = sqliteTable(
	'self_reward_credits',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		ownerId: text('owner_id')
			.notNull()
			.unique()
			.references(() => user.id, { onDelete: 'cascade' }),
		credits: integer('credits').notNull().default(0),
		...timestamps
	},
	(table) => [index('self_reward_credits_owner_idx').on(table.ownerId)]
);

/**
 * One self-reward redemption.
 *
 * The title/description/cost are snapshotted so visible history stays truthful
 * even if the reward is edited later. The foreign key still exists so the row
 * can be grouped back to the source reward while it lives.
 */
export const selfRewardClaims = sqliteTable(
	'self_reward_claims',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		ownerId: text('owner_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		rewardId: text('reward_id')
			.notNull()
			.references(() => selfRewards.id, { onDelete: 'cascade' }),
		rewardTitle: text('reward_title').notNull(),
		rewardDescription: text('reward_description'),
		rewardCost: integer('reward_cost').notNull(),
		...timestamps
	},
	(table) => [
		index('self_reward_claims_owner_created_idx').on(table.ownerId, table.createdAt),
		index('self_reward_claims_reward_idx').on(table.rewardId)
	]
);

/**
 * A reward shared inside one partnership.
 *
 * `createdByUserId` is load-bearing: under shared control, both people may
 * create and edit rewards, but a user may never claim one they authored.
 */
export const partnershipRewards = sqliteTable(
	'partnership_rewards',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		partnershipId: text('partnership_id')
			.notNull()
			.references(() => partnerships.id, { onDelete: 'cascade' }),
		createdByUserId: text('created_by_user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		description: text('description'),
		cost: integer('cost').notNull(),
		active: integer('active', { mode: 'boolean' }).notNull().default(true),
		...timestamps
	},
	(table) => [
		index('partnership_rewards_partnership_active_idx').on(table.partnershipId, table.active),
		index('partnership_rewards_partnership_created_idx').on(table.partnershipId, table.createdAt),
		index('partnership_rewards_creator_idx').on(table.createdByUserId)
	]
);

/** One credit balance per member per partnership. */
export const partnershipRewardCredits = sqliteTable(
	'partnership_reward_credits',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		partnershipId: text('partnership_id')
			.notNull()
			.references(() => partnerships.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		credits: integer('credits').notNull().default(0),
		...timestamps
	},
	(table) => [
		uniqueIndex('partnership_reward_credits_partnership_user_unq').on(
			table.partnershipId,
			table.userId
		),
		index('partnership_reward_credits_user_partnership_idx').on(table.userId, table.partnershipId)
	]
);

/**
 * One redemption of a partnership reward.
 *
 * `createdByUserId` is copied so history still shows whose reward it was if
 * the source row is later edited inactive, and so home can render a compact
 * history without joining back through the live reward table.
 */
export const partnershipRewardClaims = sqliteTable(
	'partnership_reward_claims',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		partnershipId: text('partnership_id')
			.notNull()
			.references(() => partnerships.id, { onDelete: 'cascade' }),
		rewardId: text('reward_id')
			.notNull()
			.references(() => partnershipRewards.id, { onDelete: 'cascade' }),
		claimedByUserId: text('claimed_by_user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		createdByUserId: text('created_by_user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		rewardTitle: text('reward_title').notNull(),
		rewardDescription: text('reward_description'),
		rewardCost: integer('reward_cost').notNull(),
		...timestamps
	},
	(table) => [
		index('partnership_reward_claims_partnership_claimed_idx').on(
			table.partnershipId,
			table.claimedByUserId,
			table.createdAt
		),
		index('partnership_reward_claims_reward_idx').on(table.rewardId)
	]
);

/**
 * A user-managed task in the self scope.
 *
 * `timezoneOwnerUserId` is still stored even though it always points at the
 * owner in this first pass. Keeping the same column shape as partnership tasks
 * means the scheduling layer can treat both scopes uniformly, while the UI
 * still omits the toggle for self tasks.
 */
export const selfTasks = sqliteTable(
	'self_tasks',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		ownerId: text('owner_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		description: text('description'),
		active: integer('active', { mode: 'boolean' }).notNull().default(true),
		creditsAwarded: integer('credits_awarded').notNull().default(0),
		completionMessages: text('completion_messages', { mode: 'json' }).$type<string[]>().notNull(),
		schedule: text('schedule', { mode: 'json' }).$type<TaskSchedule>().notNull(),
		timezoneOwnerUserId: text('timezone_owner_user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		lastCompletedAt: integer('last_completed_at', { mode: 'timestamp_ms' }),
		completedCount: integer('completed_count').notNull().default(0),
		nextEligibleAt: integer('next_eligible_at', { mode: 'timestamp_ms' }),
		...timestamps
	},
	(table) => [
		index('self_tasks_owner_active_idx').on(table.ownerId, table.active),
		index('self_tasks_owner_next_eligible_idx').on(table.ownerId, table.nextEligibleAt),
		index('self_tasks_timezone_owner_idx').on(table.timezoneOwnerUserId)
	]
);

/**
 * One completion of a self task.
 *
 * The title, description, reward amount and chosen completion message are
 * snapshotted so visible history stays truthful if the task changes later.
 */
export const selfTaskCompletions = sqliteTable(
	'self_task_completions',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		ownerId: text('owner_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		taskId: text('task_id')
			.notNull()
			.references(() => selfTasks.id, { onDelete: 'cascade' }),
		taskTitle: text('task_title').notNull(),
		taskDescription: text('task_description'),
		creditsAwarded: integer('credits_awarded').notNull(),
		completionMessage: text('completion_message'),
		...timestamps
	},
	(table) => [
		index('self_task_completions_owner_created_idx').on(table.ownerId, table.createdAt),
		index('self_task_completions_task_idx').on(table.taskId)
	]
);

/**
 * A task managed inside one partnership.
 *
 * `createdByUserId` is load-bearing for shared control, where both people may
 * create tasks but nobody may complete one they authored themselves.
 * `timezoneOwnerUserId` points at whose local timezone the task's scheduled
 * dates are relative to, so later timezone changes preserve that relationship.
 */
export const partnershipTasks = sqliteTable(
	'partnership_tasks',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		partnershipId: text('partnership_id')
			.notNull()
			.references(() => partnerships.id, { onDelete: 'cascade' }),
		createdByUserId: text('created_by_user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		timezoneOwnerUserId: text('timezone_owner_user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		description: text('description'),
		active: integer('active', { mode: 'boolean' }).notNull().default(true),
		creditsAwarded: integer('credits_awarded').notNull().default(0),
		completionMessages: text('completion_messages', { mode: 'json' }).$type<string[]>().notNull(),
		schedule: text('schedule', { mode: 'json' }).$type<TaskSchedule>().notNull(),
		lastCompletedAt: integer('last_completed_at', { mode: 'timestamp_ms' }),
		completedCount: integer('completed_count').notNull().default(0),
		nextEligibleAt: integer('next_eligible_at', { mode: 'timestamp_ms' }),
		...timestamps
	},
	(table) => [
		index('partnership_tasks_partnership_active_idx').on(table.partnershipId, table.active),
		index('partnership_tasks_partnership_next_eligible_idx').on(
			table.partnershipId,
			table.nextEligibleAt
		),
		index('partnership_tasks_creator_idx').on(table.createdByUserId),
		index('partnership_tasks_timezone_owner_idx').on(table.timezoneOwnerUserId)
	]
);

/**
 * One completion of a partnership task.
 *
 * `createdByUserId` and the task details are copied so history can be rendered
 * without consulting the live task row, and so the original authorship rule is
 * still visible after later task edits.
 */
export const partnershipTaskCompletions = sqliteTable(
	'partnership_task_completions',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		partnershipId: text('partnership_id')
			.notNull()
			.references(() => partnerships.id, { onDelete: 'cascade' }),
		taskId: text('task_id')
			.notNull()
			.references(() => partnershipTasks.id, { onDelete: 'cascade' }),
		completedByUserId: text('completed_by_user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		createdByUserId: text('created_by_user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		taskTitle: text('task_title').notNull(),
		taskDescription: text('task_description'),
		creditsAwarded: integer('credits_awarded').notNull(),
		completionMessage: text('completion_message'),
		...timestamps
	},
	(table) => [
		index('partnership_task_completions_partnership_completed_idx').on(
			table.partnershipId,
			table.completedByUserId,
			table.createdAt
		),
		index('partnership_task_completions_task_idx').on(table.taskId)
	]
);

/**
 * A user's long-term age recipient — their public key.
 *
 * Stored in the clear because it is public by construction: everything a
 * partner needs to encrypt *to* this user, and nothing that decrypts anything.
 *
 * One row per user. The recipient is replaced only in one situation — a
 * forgotten password, which loses the identity for good and starts a
 * partner-assisted history restore. Ordinary use never rotates it, because the
 * server holds ciphertext only and there would be nothing to re-encrypt from.
 *
 * There is deliberately no `generation` or `rotatedAt` column. Everything on
 * this row is server-controlled, so a client could not use such a column to
 * decide whether a key change was legitimate — that decision is made against a
 * locally pinned copy (see `pinStateFor` in `src/lib/encryption.ts`), and a
 * column here would only look as though it helped.
 */
export const userKeys = sqliteTable('user_keys', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	// Unique rather than being the primary key, to match the id-plus-unique
	// shape of every other table here. The constraint doubles as the index for
	// the only query path there is: "this user's recipient".
	userId: text('user_id')
		.notNull()
		.unique()
		.references(() => user.id, { onDelete: 'cascade' }),
	/** `age1...`, bech32. Public. */
	recipient: text('recipient').notNull(),
	/**
	 * When the user ticked "I have written my password down".
	 *
	 * NULL means the warning has not been acknowledged yet, and the messaging
	 * board shows it as an interstitial instead of the board. Stored server-side
	 * rather than in localStorage on purpose: the warning is about losing every
	 * message on every device, so it should not be dismissible by clearing site
	 * data or by picking up a different phone.
	 */
	historyWarningAckAt: integer('history_warning_ack_at', { mode: 'timestamp_ms' }),
	/**
	 * Whether this user has explicitly opted in or out of automatic URL embeds.
	 *
	 * NULL means they have not answered yet, so this device may still prompt
	 * after repeated manual reveals. Stored with the rest of the message-key
	 * settings because it only affects encrypted-message rendering.
	 */
	embedAutoLoad: integer('embed_auto_load', { mode: 'boolean' }),
	...timestamps
});

/**
 * One way to unlock a user's age identity. Many rows per user, on purpose.
 *
 * The server stores a `type`, an opaque `params` blob it never reads, and the
 * ciphertext. That is the whole extension point: another unlock method is a new
 * `type` and new client code, not a migration.
 *
 * `params` is JSON for the same reason the `edge_tasks.instructions` column is:
 * SQLite has no
 * JSON type, `mode: 'json'` handles the round trip, and `$type` gives it
 * end-to-end typing without the server needing to understand the contents.
 *
 * NOTE: there is deliberately NO unique index on (user_id, type). Two password
 * wraps existing at once is a required transient state — a password change
 * inserts the new wrap *before* changing the credential, so that a crash
 * between the two leaves two wraps of which exactly one opens, rather than none.
 * Adding that index would break password changes in a way that only shows up
 * when a request dies half way through.
 */
export const userKeyWraps = sqliteTable(
	'user_key_wraps',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		type: text('type').$type<KeyWrapType>().notNull(),
		params: text('params', { mode: 'json' }).$type<KeyWrapParams>().notNull(),
		/** base64url of `12-byte IV || AES-256-GCM ciphertext || 16-byte tag`. */
		blob: text('blob').notNull(),
		/** Shown as "this passkey has never been used to unlock". Gates nothing. */
		lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
		/** User-facing, e.g. "iPhone passkey". */
		label: text('label'),
		...timestamps
	},
	// Every read is "all wraps for this user"; unlock tries them in turn.
	(table) => [index('user_key_wraps_user_id_idx').on(table.userId)]
);

/**
 * One self-contained exchange between the two people in a partnership.
 *
 * Not a chat log: the feature is many small threads, so `partnership_id` is
 * indexed together with `last_message_at` and every board read is one range
 * scan over this table plus a left join on `thread_reads`. `messages` is never
 * touched to render the board — that is what the two denormalised columns are
 * for.
 */
export const messageThreads = sqliteTable(
	'message_threads',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		partnershipId: text('partnership_id')
			.notNull()
			.references(() => partnerships.id, { onDelete: 'cascade' }),
		/**
		 * The sticker this thread shows on the board. PLAINTEXT, and re-validated
		 * against `THREAD_ICONS` at every write path.
		 *
		 * The one unencrypted piece of user-chosen content in the feature, and the
		 * reason is that the board is the screen you look at to *decide* what to
		 * open — it has to render before any key is unlocked. What that leaks is
		 * about four bits from a fixed list of sixteen, next to timestamps, sender
		 * ids, read receipts and exact ciphertext byte sizes the server cannot
		 * avoid knowing anyway.
		 *
		 * The closed list is the load-bearing part. A free-text plaintext column
		 * here would be a covert channel for arbitrary prose, which is why
		 * `isThreadIcon` is checked in `server/messaging.ts` as well as in the
		 * endpoint's Zod schema — see AGENTS.md invariant 14.
		 */
		icon: text('icon').$type<ThreadIcon>().notNull(),
		/**
		 * Denormalised from `messages`, written in the same `db.batch()` as the
		 * insert.
		 *
		 * Two columns rather than one, because "unread" is per-viewer:
		 * `last_message_at` on its own would mark a thread unread for whoever had
		 * just posted in it. `sendMessage()` is the only writer of both, and it
		 * also upserts the sender's own `thread_reads` row in the same batch —
		 * which is what makes "the newest message is mine" a sound proxy for "I
		 * have read this thread", enforced on the server rather than by the UI.
		 *
		 * The rejected alternative was a pair of columns keyed on the permanent
		 * inviter/invitee roles, mirroring `inviter_name`/`invitee_name`. It works,
		 * but it puts role resolution inside SQL, and invariant 12 exists
		 * precisely because that mapping must live in exactly one place.
		 */
		lastMessageAt: integer('last_message_at', { mode: 'timestamp_ms' }).notNull(),
		lastMessageSenderId: text('last_message_sender_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		...timestamps
	},
	(table) => [
		// The board's hot path: where partnership_id = ? order by last_message_at.
		index('message_threads_partnership_last_message_idx').on(
			table.partnershipId,
			table.lastMessageAt
		),
		// /home's per-partner unread counts filter on the sender before the join.
		index('message_threads_partnership_sender_idx').on(
			table.partnershipId,
			table.lastMessageSenderId
		)
	]
);

/** A reusable, partnership-scoped label for message threads. */
export const messageTags = sqliteTable(
	'message_tags',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		partnershipId: text('partnership_id')
			.notNull()
			.references(() => partnerships.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		color: text('color').notNull(),
		...timestamps
	},
	(table) => [
		uniqueIndex('message_tags_partnership_name_unq').on(table.partnershipId, table.name),
		index('message_tags_partnership_idx').on(table.partnershipId)
	]
);

/** Many-to-many assignment so a thread can carry several reusable tags. */
export const messageThreadTags = sqliteTable(
	'message_thread_tags',
	{
		threadId: text('thread_id')
			.notNull()
			.references(() => messageThreads.id, { onDelete: 'cascade' }),
		tagId: text('tag_id')
			.notNull()
			.references(() => messageTags.id, { onDelete: 'cascade' })
	},
	(table) => [
		uniqueIndex('message_thread_tags_thread_tag_unq').on(table.threadId, table.tagId),
		index('message_thread_tags_tag_idx').on(table.tagId)
	]
);

export type MessageTag = typeof messageTags.$inferSelect;
export type NewMessageTag = typeof messageTags.$inferInsert;

/**
 * One message. `ciphertext` is base64 of an age-encrypted body, and the server
 * learns nothing from it — not even the plaintext's length, beyond a bound.
 *
 * base64 `text` rather than `blob`, for three reasons in order of weight:
 * SvelteKit serialises load data with devalue, which cannot carry a
 * `Uint8Array`, so a blob column would need base64 at the boundary anyway;
 * `text` round-trips identically through libsql (dev and tests) and D1
 * (production), which a blob does not; and the 33% overhead applies only to
 * bodies, since attachments are raw bytes in R2 where it would have mattered.
 *
 * D1's per-value ceiling is 2,000,000 bytes. `MAX_CIPHERTEXT_BYTES` caps this
 * at 64 KB, well below it. Note the statement-length limit (100,000 bytes) is
 * not a concern only because drizzle sends this as a bound parameter rather
 * than inlining it — a hand-rolled `wrangler d1 execute` would hit it.
 */
export const messages = sqliteTable(
	'messages',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		threadId: text('thread_id')
			.notNull()
			.references(() => messageThreads.id, { onDelete: 'cascade' }),
		senderId: text('sender_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		ciphertext: text('ciphertext').notNull(),
		/**
		 * LEGACY-RICHTEXT — which serialisation the body inside `ciphertext` uses.
		 *
		 * PLAINTEXT, and deliberately a closed two-value list: the server holds
		 * only ciphertext, so this is the only way it can tell a message written
		 * before rich text from one converted since. See `MESSAGE_BODY_FORMATS`
		 * in `src/lib/messaging.ts` for why it exists and
		 * docs/temporary-code.md for when it goes.
		 *
		 * Defaults to `'plain'` so every existing row is correctly labelled by
		 * the migration that adds the column.
		 */
		bodyFormat: text('body_format').$type<MessageBodyFormat>().notNull().default('plain'),
		/**
		 * An encrypted sidecar for derived message metadata, such as cached embed
		 * details resolved from URLs in the body.
		 *
		 * Kept separate from `ciphertext` so the app can add or backfill derived
		 * data without rewriting the author-written body itself. Encrypted for the
		 * same reason as the body: a cached title or thumbnail URL is still message
		 * content derived from plaintext the server must not store in the clear.
		 */
		metadataCiphertext: text('metadata_ciphertext'),
		...timestamps
	},
	(table) => [
		// The thread view: where thread_id = ? order by created_at, id. `id` is in
		// the index so the tiebreak is covered too — two messages can share a
		// millisecond, and ordering by a UUID alone is never meaningful (invariant 8).
		index('messages_thread_created_idx').on(table.threadId, table.createdAt, table.id)
	]
);

/**
 * An encrypted image or video living in R2 — or, under `vite dev`, in a local
 * directory. See `src/lib/server/media/`.
 *
 * NO filename and NO mime type, deliberately: both live inside the encrypted
 * body, so the server learns only that a file exists and how many bytes it is.
 *
 * Each file is encrypted under its own ephemeral age identity, and that
 * identity travels inside the message body rather than the file being encrypted
 * to the two partners directly. That is what makes partner-assisted recovery
 * affordable: restoring someone's history re-encrypts message *bodies*, a few
 * kilobytes each, and never touches the 25 MB objects in R2.
 */
export const messageAttachments = sqliteTable(
	'message_attachments',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		messageId: text('message_id')
			.notNull()
			.references(() => messages.id, { onDelete: 'cascade' }),
		/** Ciphertext size, which is what the 25 MB cap is enforced against. */
		byteSize: integer('byte_size').notNull(),
		/**
		 * The object key, written before the DB rows and never derived from them
		 * at read time.
		 *
		 * The layout is `messages/<partnershipId>/<messageId>/<id>` so that
		 * disconnecting can delete a whole prefix, but storing the key means that
		 * layout can change without a migration.
		 *
		 * Nothing cascades from D1 into R2. Deleting a partnership removes these
		 * rows and leaves the objects — see `purgePartnershipMedia`.
		 */
		storageKey: text('storage_key').notNull(),
		...timestamps
	},
	(table) => [index('message_attachments_message_id_idx').on(table.messageId)]
);

/**
 * A tapback. One per user per message, replaced rather than appended.
 *
 * Encrypted, unlike the thread icon, and the contrast is deliberate: a reaction
 * only ever renders inside a thread that is already unlocked, so encrypting it
 * costs nothing at all. Keeping both decisions in view is what makes either
 * defensible.
 *
 * "You may only react to messages you received" is enforced in `setReaction()`,
 * not here: a SQLite CHECK constraint cannot see another table's `sender_id`.
 */
export const messageReactions = sqliteTable(
	'message_reactions',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		messageId: text('message_id')
			.notNull()
			.references(() => messages.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		ciphertext: text('ciphertext').notNull(),
		...timestamps
	},
	(table) => [
		// The uniqueness IS the rule ("one reaction per user per message"), and it
		// is what onConflictDoUpdate targets — so it is a constraint rather than a
		// convention enforced in application code.
		uniqueIndex('message_reactions_message_user_unq').on(table.messageId, table.userId)
	]
);

/**
 * Per-user read state for one thread.
 *
 * `created_at` from the timestamps helper IS "first opened" — a separate column
 * would be the same value written twice.
 *
 * `last_read_message_at` holds a timestamp rather than a message id, and is
 * compared against the thread's `last_message_at`, so a message that arrives
 * between the read being written and the next board render is correctly still
 * unread.
 */
export const threadReads = sqliteTable(
	'thread_reads',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		threadId: text('thread_id')
			.notNull()
			.references(() => messageThreads.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		/**
		 * Drives the read half of the board order: when the thread most recently
		 * became fully read.
		 */
		lastFullyReadAt: integer('last_fully_read_at', { mode: 'timestamp_ms' }).notNull(),
		lastReadMessageAt: integer('last_read_message_at', { mode: 'timestamp_ms' }).notNull(),
		...timestamps
	},
	(table) => [
		uniqueIndex('thread_reads_thread_user_unq').on(table.threadId, table.userId),
		// The board's left join, and /home's aggregate, both look up (user, thread).
		index('thread_reads_user_thread_idx').on(table.userId, table.threadId)
	]
);

/**
 * A request for a partner to re-encrypt the shared history to a new key.
 *
 * Raised after a forgotten password, which is unrecoverable on its own: the
 * wrap is the only copy of the identity and the password is the only way in.
 * But both people can already decrypt every message in the partnership, so the
 * other one can re-encrypt it — the server cannot help, and does not need to.
 *
 * `requestedRecipient` is a SNAPSHOT, and that is the security-relevant part.
 * The partner confirms against the recipient they compared out of band, and the
 * re-encryption targets exactly that string — not whatever `user_keys` happens
 * to say at upload time. Without the snapshot, a malicious server could swap
 * the recipient between the confirmation and the upload and have the partner
 * hand it the entire history.
 */
export const historyRestoreRequests = sqliteTable(
	'history_restore_requests',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		partnershipId: text('partnership_id')
			.notNull()
			.references(() => partnerships.id, { onDelete: 'cascade' }),
		/** Who lost their key. The other member is the one who can act on it. */
		requesterId: text('requester_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		requestedRecipient: text('requested_recipient').notNull(),
		status: text('status').$type<RestoreRequestStatus>().notNull().default('pending'),
		resolvedAt: integer('resolved_at', { mode: 'timestamp_ms' }),
		...timestamps
	},
	(table) => [
		// The partner's board asks "is anyone waiting on me in this partnership?".
		index('history_restore_requests_partnership_status_idx').on(table.partnershipId, table.status)
	]
);

export type UserKeys = typeof userKeys.$inferSelect;
export type NewUserKeys = typeof userKeys.$inferInsert;
export type UserKeyWrap = typeof userKeyWraps.$inferSelect;
export type NewUserKeyWrap = typeof userKeyWraps.$inferInsert;
export type MessageThread = typeof messageThreads.$inferSelect;
export type NewMessageThread = typeof messageThreads.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type MessageAttachment = typeof messageAttachments.$inferSelect;
export type NewMessageAttachment = typeof messageAttachments.$inferInsert;
export type MessageReaction = typeof messageReactions.$inferSelect;
export type NewMessageReaction = typeof messageReactions.$inferInsert;
export type ThreadRead = typeof threadReads.$inferSelect;
export type NewThreadRead = typeof threadReads.$inferInsert;
export type HistoryRestoreRequest = typeof historyRestoreRequests.$inferSelect;
export type NewHistoryRestoreRequest = typeof historyRestoreRequests.$inferInsert;
