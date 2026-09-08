import { error } from '@sveltejs/kit';
import { createNotifier } from '$lib/server/realtime/dev';
import { requireMembership } from '$lib/server/messaging';
import type { RequestHandler } from './$types';

/**
 * The live feed for one partnership.
 *
 * Outside both route groups on purpose — see AGENTS.md. A group guard is a
 * layout load and layout loads never run for a `+server.ts`, so the membership
 * check is here explicitly.
 *
 * What travels down this stream is metadata only: `{ kind, threadId }` and
 * nothing else. The client's whole reaction is to `invalidate()` the load it
 * already has, which then re-reads through the same authorised path as a normal
 * navigation. So this endpoint hands out no content and cannot be turned into
 * one that does without changing `RealtimeEvent`.
 *
 * No `Content-Length` and no compression: it is an open-ended stream, and a
 * compressing intermediary would buffer it — see `SSE_HEADERS`.
 */
export const GET: RequestHandler = async ({ locals, params, platform }) => {
	if (!locals.user) error(401, 'Not signed in');

	// The same 404-not-403 as every other partner route: distinguishing them
	// would confirm the id is real.
	const membership = await requireMembership(locals.db, params.id, locals.user.id);
	if (!membership) error(404, 'Partner not found');

	const notifier = await createNotifier({ platform });
	return notifier.stream(params.id);
};
