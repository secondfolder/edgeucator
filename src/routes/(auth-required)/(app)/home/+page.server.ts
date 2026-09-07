import { listUnreadCounts } from '$lib/server/messaging';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, parent, depends }) => {
	// The group guard has already run for a layout load. Degrade rather than
	// throw if that ever changes.
	if (!locals.user) return { unread: [] };

	// The app shell's layout has already loaded the partner list for the bottom
	// nav, so take it from there rather than reading `partnerships` a second
	// time. It also carries the per-viewer name, which is resolved in exactly
	// one place (invariant 12).
	const { partners } = await parent();

	depends('messages:unread');

	return { unread: await listUnreadCounts(locals.db, locals.user.id, partners) };
};
