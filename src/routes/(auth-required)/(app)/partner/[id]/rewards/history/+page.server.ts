import { error } from '@sveltejs/kit';
import { getPartnershipRewardsPage } from '$lib/server/rewards';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, depends }) => {
	if (!locals.user) error(401, 'Not signed in');

	depends(`rewards:partner:${params.id}`);

	const page = await getPartnershipRewardsPage(locals.db, params.id, locals.user.id);
	if (!page) error(404, 'Partner not found');
	return page;
};
