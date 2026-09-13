import { error, json } from '@sveltejs/kit';
import { setThreadTags } from '$lib/server/messaging';
import { createNotifier } from '$lib/server/realtime/dev';
import type { RequestHandler } from './$types';

export const PUT: RequestHandler = async ({ locals, params, request, platform }) => {
	if (!locals.user) error(401, 'Not signed in');
	const body = (await request.json().catch(() => null)) as { tagIds?: unknown } | null;
	const tagIds =
		Array.isArray(body?.tagIds) && body.tagIds.every((id) => typeof id === 'string')
			? body.tagIds
			: null;
	if (!tagIds) error(400, 'Tag ids must be an array');
	const result = await setThreadTags(locals.db, params.id, locals.user.id, params.threadId, tagIds);
	if (!result.ok) error(404, 'Not found');
	const notifier = await createNotifier({ platform });
	await notifier.publish(params.id, { kind: 'thread', threadId: params.threadId });
	return json({ ok: true });
};
