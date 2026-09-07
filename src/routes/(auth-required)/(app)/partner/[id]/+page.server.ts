import { error } from '@sveltejs/kit';
import { findPlaceholderPartner } from '$lib/placeholder-partners';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const partner = findPlaceholderPartner(params.id);
	if (!partner) {
		error(404, 'Partner not found');
	}

	return { partner };
};
