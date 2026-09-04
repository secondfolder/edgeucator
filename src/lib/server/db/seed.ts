import { createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import { guides, tasks } from './schema/app';
import { guideSeeds } from './seed-data';

/**
 * Seeds the local dev SQLite database.
 *
 * Runs under `tsx` against ./local.db — the same file `npm run dev` reads — so
 * it needs no Cloudflare account and no wrangler. Deliberately imports
 * `./schema/app` rather than the schema barrel, to keep the Better Auth tables
 * out of this script's module graph.
 *
 * Idempotent: seed ids are fixed, guides are upserted, and each guide's tasks
 * are replaced wholesale, so running it repeatedly is a no-op.
 *
 *   npm run db:migrate && npm run db:seed
 */
const client = createClient({ url: process.env.DATABASE_URL || 'file:./local.db' });
const db = drizzle(client, { schema: { guides, tasks } });

for (const seed of guideSeeds) {
	await db
		.insert(guides)
		.values({ id: seed.id, title: seed.title })
		.onConflictDoUpdate({
			target: guides.id,
			set: { title: seed.title, updatedAt: new Date() }
		});

	// Replace this guide's tasks rather than diffing them.
	await db.delete(tasks).where(eq(tasks.guideId, seed.id));

	if (seed.tasks.length > 0) {
		await db.insert(tasks).values(
			seed.tasks.map((task, index) => ({
				id: `${seed.id}-task-${index}`,
				guideId: seed.id,
				order: task.order,
				instructions: task.instructions
			}))
		);
	}

	console.log(`seeded guide ${seed.id} (${seed.tasks.length} task(s))`);
}
