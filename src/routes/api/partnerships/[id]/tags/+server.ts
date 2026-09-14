import { error, json } from '@sveltejs/kit';
import { createTag, listTags } from '$lib/server/messaging';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) error(401, 'Not signed in');
	const tags = await listTags(locals.db, params.id, locals.user.id);
	if (!tags) error(404, 'Not found');
	return json({ tags });
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user) error(401, 'Not signed in');
	const body = (await request.json().catch(() => null)) as {
		name?: unknown;
		color?: unknown;
	} | null;
	const result = await createTag(
		locals.db,
		params.id,
		locals.user.id,
		typeof body?.name === 'string' ? body.name : '',
		typeof body?.color === 'string' ? body.color : undefined
	);
	if (!result.ok) {
		if (result.reason === 'not-a-member') error(404, 'Not found');
		if (result.reason === 'duplicate-name') error(409, 'That tag already exists');
		error(400, 'Tag name must contain 1 to 80 characters');
	}
	return json(result.tag, { status: 201 });
};
