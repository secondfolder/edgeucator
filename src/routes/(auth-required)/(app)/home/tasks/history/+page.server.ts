import { error } from '@sveltejs/kit';
import { getSelfTasksSection } from '$lib/server/tasks';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, depends }) => {
	if (!locals.user) error(401, 'Not signed in');

	depends('tasks:home');

	return {
		selfTasks: await getSelfTasksSection(locals.db, locals.user.id, locals.user.timezone)
	};
};
