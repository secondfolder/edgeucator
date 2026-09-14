import { error } from '@sveltejs/kit';
import { getPartnershipForUser } from '$lib/server/partnerships';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.user) error(401, 'Not signed in');

	const partnership = await getPartnershipForUser(locals.db, params.id, locals.user.id);
	// A pending invite has no partner behind it yet, so it gets no partner page
	// — the nav does not link to one either. 404 rather than 403 for a
	// partnership belonging to someone else: distinguishing them would confirm
	// the id is real.
	if (!partnership || partnership.status !== 'accepted') error(404, 'Partner not found');

	// `inviteToken` is deliberately not returned: load data is serialised into
	// the page HTML, and an accepted partnership has no live token anyway.
	return {
		partner: {
			id: partnership.id,
			name: partnership.partnerName,
			yourName: partnership.yourName,
			image: partnership.counterpart?.image ?? null,
			timezone: partnership.counterpart?.timezone ?? null,
			partnerRole: partnership.partnerRole,
			yourRole: partnership.yourRole,
			canEdit: partnership.canEdit
		}
	};
};
