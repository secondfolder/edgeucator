import { relations } from "drizzle-orm/relations";
import { pgTable, foreignKey, pgPolicy, bigint, timestamp, uuid, text, jsonb, pgSchema } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

const authSchema = pgSchema('auth');

export const users = authSchema.table('users', {
	id: uuid('id').primaryKey(),
});

export const usersRelations = relations(users, ({many}) => ({
	notes: many(notes),
}));

export const guides = pgTable("guides", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedByDefaultAsIdentity({ name: "guides_id_seq", startWith: 1, increment: 1, minValue: 1, cache: 1 }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	title: text().notNull(),
});

export const guidesRelations = relations(guides, ({many}) => ({
	tasks: many(tasks),
}));

export const tasks = pgTable("tasks", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedByDefaultAsIdentity({ name: "tasks_id_seq", startWith: 1, increment: 1, minValue: 1, cache: 1 }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	guideId: bigint("guide_id", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	order: bigint({ mode: "number" }).notNull(),
	instructions: jsonb().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.guideId],
			foreignColumns: [guides.id],
			name: "tasks_guide_id_fkey"
		}).onDelete("cascade"),
]);

export const tasksRelations = relations(tasks, ({one}) => ({
	guide: one(guides, {
		fields: [tasks.guideId],
		references: [guides.id]
	}),
}));




export const notes = pgTable("notes", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "notes_id_seq", startWith: 1, increment: 1, minValue: 1, cache: 1 }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	userId: uuid("user_id").default(sql`auth.uid()`).notNull(),
	note: text().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "notes_user_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("Users can access and modify their own notes", { as: "permissive", for: "all", to: ["authenticated"], using: sql`(( SELECT auth.uid() AS uid) = user_id)` }),
]);

export const notesRelations = relations(notes, ({one}) => ({
	users: one(users, {
		fields: [notes.userId],
		references: [users.id]
	}),
}));