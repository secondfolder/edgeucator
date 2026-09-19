import { error } from '@sveltejs/kit';
import { getRecipientsForPartnership, getUserKeys } from '$lib/server/keys';
import {
	getThread,
	listTags,
	markThreadOpened,
	requireThreadMembership
} from '$lib/server/messaging';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, depends }) => {
	if (!locals.user) error(401, 'Not signed in');

	// The thread id is re-joined against this partnership rather than trusted:
	// being in *a* partnership is not being in *this* one.
	const membership = await requireThreadMembership(
		locals.db,
		params.id,
		params.threadId,
		locals.user.id
	);
	if (!membership) error(404, 'Not found');

	depends(`messages:thread:${params.threadId}`);

	const [thread, recipients, keys, tags] = await Promise.all([
		getThread(locals.db, params.threadId, membership.icon, locals.user.id),
		getRecipientsForPartnership(locals.db, params.id, locals.user.id),
		getUserKeys(locals.db, locals.user.id),
		listTags(locals.db, params.id, locals.user.id)
	]);

	/**
	 * A load that writes, which is unusual enough to justify.
	 *
	 * Opening the thread *is* the read event — there is no separate gesture to
	 * hang an action on, and doing it from a client `fetch` after hydration
	 * would lose the read for anyone who taps in and straight back out again.
	 *
	 * Deliberately not awaited before the response: the mark is not something
	 * the page renders, and making the user wait on a write to see their own
	 * messages would be the wrong trade. A failure means the thread stays
	 * unread, which is recoverable by opening it again.
	 */
	void markThreadOpened(locals.db, params.threadId, locals.user.id).catch((cause) => {
		console.error('could not mark thread read', cause);
	});

	return {
		partner: {
			id: membership.partnership.id,
			name: membership.partnership.partnerName
		},
		thread,
		tags: tags ?? [],
		recipients: recipients ?? { mine: null, theirs: null },
		embedAutoLoad: keys?.embedAutoLoad ?? null
	};
};
