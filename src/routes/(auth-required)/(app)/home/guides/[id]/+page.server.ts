import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals: { db } }) => {
	const guide = await db.query.guides.findFirst({
		where: (guides, { eq }) => eq(guides.id, params.id),
		columns: { id: true, title: true },
		with: {
			edgeTasks: {
				columns: { id: true, order: true, instructions: true },
				// Order by `order`, not `id`. The old code ordered by id, which only
				// happened to work while ids were autoincrement integers.
				orderBy: (edgeTasks, { asc }) => [asc(edgeTasks.order), asc(edgeTasks.id)]
			}
		}
	});

	// The previous version returned `{ status: 404 }` as page *data*, which
	// SvelteKit ignores — so the route rendered a 200 with `guide === undefined`
	// and then threw in Guide.svelte. It also guarded params.id against
	// PocketBase's /^[a-z0-9]+$/ id shape, which would reject a UUID; that guard
	// is gone, since Drizzle parameterises and "not found" is the real check.
	if (!guide) {
		error(404, 'Guide not found');
	}

	return { guide, edgeTasks: guide.edgeTasks };
};
