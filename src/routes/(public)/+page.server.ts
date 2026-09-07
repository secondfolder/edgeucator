import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	// `/` is the logged-out landing page only. Once you have a session the home
	// screen is /home, which is where every post-auth redirect points too.
	if (locals.user) redirect(303, '/home');
};
