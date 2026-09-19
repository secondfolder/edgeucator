import { error, json } from '@sveltejs/kit';
import { setEmbedAutoLoadPreference } from '$lib/server/keys';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) error(401, 'Not signed in');

	const body = (await request.json().catch(() => null)) as { enabled?: unknown } | null;
	if (typeof body?.enabled !== 'boolean') {
		return json({ ok: false, error: 'Choose yes or no' }, { status: 400 });
	}

	await setEmbedAutoLoadPreference(locals.db, locals.user.id, body.enabled);
	return json({ ok: true, enabled: body.enabled });
};
