import { APIError } from 'better-auth/api';
import { error, json } from '@sveltejs/kit';
import { canonicalizeTimeZone } from '$lib/timezone';
import { updateCurrentUserProfile } from '$lib/server/user-settings';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) error(401, 'Not signed in');

	const form = await request.formData();
	const timezone = canonicalizeTimeZone(String(form.get('timezone') ?? ''));
	if (!timezone) {
		return json({ ok: false, error: 'Use a valid timezone like Europe/London' }, { status: 400 });
	}

	try {
		await updateCurrentUserProfile(locals.auth, request.headers, { timezone });
	} catch (caught) {
		if (caught instanceof APIError) {
			return json(
				{ ok: false, error: caught.body?.message ?? 'Could not update your timezone' },
				{ status: 400 }
			);
		}

		console.error(caught);
		return json({ ok: false, error: 'Could not update your timezone' }, { status: 500 });
	}

	return json({ ok: true, timezone });
};
