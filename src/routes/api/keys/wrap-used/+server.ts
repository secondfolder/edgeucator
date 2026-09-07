import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { touchWrap } from '$lib/server/keys';
import type { RequestHandler } from './$types';

const bodySchema = z.object({ wrapId: z.uuid() });

/**
 * Notes that a wrap actually opened, so the settings screen can say "this
 * passkey has never been used to unlock".
 *
 * Displayed only, and gates nothing — which is why a failure here is swallowed
 * by the caller rather than blocking an unlock that has already succeeded.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	// See the note in ../unlock-bundle: endpoints carry their own auth check.
	if (!locals.user) error(401, 'Not signed in');

	const parsed = bodySchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, 'Malformed request');

	// Scoped to the owner inside the query, so a wrap id belonging to someone
	// else simply matches nothing.
	await touchWrap(locals.db, parsed.data.wrapId, locals.user.id);
	return json({ ok: true });
};
