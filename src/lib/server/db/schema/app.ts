import { relations, sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { TaskInstructions } from '../../../types';
import type { PartnershipControl, PartnershipStatus } from '../../../partnership';
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

export const tasks = sqliteTable(
	'tasks',
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
		instructions: text('instructions', { mode: 'json' }).$type<TaskInstructions>().notNull(),
		...timestamps
	},
	(table) => [
		// The /home/guides/[id] load's hot path: where guide_id = ? order by "order".
		index('tasks_guide_id_order_idx').on(table.guideId, table.order)
	]
);

export const guidesRelations = relations(guides, ({ many }) => ({
	tasks: many(tasks)
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
	guide: one(guides, {
		fields: [tasks.guideId],
		references: [guides.id]
	})
}));

export type Guide = typeof guides.$inferSelect;
export type NewGuide = typeof guides.$inferInsert;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;

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
		/** A shared word for the connection ("partner", "trainer"). Optional. */
		relationshipLabel: text('relationship_label'),
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
