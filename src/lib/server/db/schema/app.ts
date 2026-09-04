import { relations, sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { TaskInstructions } from '../../../types';

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
		// The /guides/[id] load's hot path: where guide_id = ? order by "order".
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
