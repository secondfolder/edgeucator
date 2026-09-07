import { error } from '@sveltejs/kit';
import { listPartnershipsForUser } from '$lib/server/partnerships';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) error(401, 'Not signed in');

	return { partnerships: await listPartnershipsForUser(locals.db, locals.user.id) };
};
