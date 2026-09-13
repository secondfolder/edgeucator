import { error, json } from '@sveltejs/kit';
import { updateTag } from '$lib/server/messaging';
import { createNotifier } from '$lib/server/realtime/dev';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ locals, params, request, platform }) => {
	if (!locals.user) error(401, 'Not signed in');
	const body = (await request.json().catch(() => null)) as {
		name?: unknown;
		color?: unknown;
	} | null;
	const result = await updateTag(locals.db, params.id, locals.user.id, params.tagId, {
		name: typeof body?.name === 'string' ? body.name : undefined,
		color: typeof body?.color === 'string' ? body.color : undefined
	});
	if (!result.ok) {
		if (result.reason === 'not-a-member' || result.reason === 'no-such-tag')
			error(404, 'Not found');
		if (result.reason === 'duplicate-name') error(409, 'That tag already exists');
		error(400, 'Invalid tag');
	}
	const notifier = await createNotifier({ platform });
	await notifier.publish(params.id, { kind: 'thread', threadId: '' });
	return json(result.tag);
};
