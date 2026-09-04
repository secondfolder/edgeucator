import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { db } }) => {
	const guides = await db.query.guides.findMany({
		columns: { id: true, title: true },
		// PocketBase's getFullList() had no sort, so ordering was whatever SQLite
		// returned. `id` is the tiebreaker because createdAt can collide when
		// several rows are seeded in the same millisecond.
		orderBy: (guides, { asc }) => [asc(guides.createdAt), asc(guides.id)]
	});

	return { guides };
};
