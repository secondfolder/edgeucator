import { userHasMessageHistory } from '$lib/server/messaging';
import { listPartnersForNav } from '$lib/server/partnerships';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	// Loaded in the layout rather than per page because the bottom nav renders
	// one tab per partner on every screen in this group. The group's own guard
	// has already run by the time a layout load does, so `locals.user` is set —
	// but this narrows for TypeScript and degrades to an empty nav rather than
	// throwing if that ever stops being true.
	if (!locals.user) return { partners: [], userHasMessageHistory: false };

	const [partners, hasMessageHistory] = await Promise.all([
		listPartnersForNav(locals.db, locals.user.id),
		userHasMessageHistory(locals.db, locals.user.id)
	]);

	return { partners, userHasMessageHistory: hasMessageHistory };
};
