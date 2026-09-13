import { error } from '@sveltejs/kit';
import { getSelfRewardsSection } from '$lib/server/rewards';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, depends }) => {
	if (!locals.user) error(401, 'Not signed in');

	depends('rewards:home');

	return { selfRewards: await getSelfRewardsSection(locals.db, locals.user.id) };
};
