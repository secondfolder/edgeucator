import { listPlaceholderPartners } from '$lib/placeholder-partners';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async () => {
	// Loaded in the layout rather than per page because the bottom nav renders
	// one avatar per partner on every screen in this group. When the partners
	// table exists this becomes a `locals.db` query scoped to `locals.user`.
	return { partners: listPlaceholderPartners() };
};
