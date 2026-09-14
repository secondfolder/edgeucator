import { createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import { edgeTasks, guides } from './schema/app';
import { guideSeeds } from './seed-data';

/**
 * Seeds the local dev SQLite database.
 *
 * Runs under `tsx` against ./local.db — the same file `npm run dev` reads — so
 * it needs no Cloudflare account and no wrangler. Deliberately imports
 * `./schema/app` rather than the schema barrel, to keep the Better Auth tables
 * out of this script's module graph.
 *
 * Idempotent: seed ids are fixed, guides are upserted, and each guide's edge
 * tasks are replaced wholesale, so running it repeatedly is a no-op.
 *
 *   npm run db:migrate && npm run db:seed
 */
const client = createClient({ url: process.env.DATABASE_URL || 'file:./local.db' });
const db = drizzle(client, { schema: { guides, edgeTasks } });

for (const seed of guideSeeds) {
	await db
		.insert(guides)
		.values({ id: seed.id, title: seed.title })
		.onConflictDoUpdate({
			target: guides.id,
			set: { title: seed.title, updatedAt: new Date() }
		});

	// Replace this guide's edge tasks rather than diffing them.
	await db.delete(edgeTasks).where(eq(edgeTasks.guideId, seed.id));

	if (seed.edgeTasks.length > 0) {
		await db.insert(edgeTasks).values(
			seed.edgeTasks.map((edgeTask, index) => ({
				id: `${seed.id}-edge-task-${index}`,
				guideId: seed.id,
				order: edgeTask.order,
				instructions: edgeTask.instructions
			}))
		);
	}

	console.log(`seeded guide ${seed.id} (${seed.edgeTasks.length} edge task(s))`);
}
