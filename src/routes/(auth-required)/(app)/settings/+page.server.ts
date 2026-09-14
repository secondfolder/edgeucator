import { error } from '@sveltejs/kit';
import { userHasMessageHistory } from '$lib/server/messaging';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) error(401, 'Not signed in');

	return {
		hasMessageHistory: await userHasMessageHistory(locals.db, locals.user.id)
	};
};
