import { error } from '@sveltejs/kit';
import { getPartnershipTasksPage } from '$lib/server/tasks';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, depends }) => {
	if (!locals.user) error(401, 'Not signed in');

	depends(`tasks:partner:${params.id}`);

	const page = await getPartnershipTasksPage(
		locals.db,
		params.id,
		locals.user.id,
		locals.user.timezone
	);
	if (!page) error(404, 'Partner not found');
	return page;
};
