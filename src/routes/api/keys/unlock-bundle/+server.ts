import { error, json } from '@sveltejs/kit';
import { getUnlockBundle } from '$lib/server/keys';
import type { RequestHandler } from './$types';

/**
 * Everything a cold device needs to unlock: the public recipient and the
 * sealed wraps. All opaque — the server cannot open any of it.
 *
 * Its own endpoint rather than fields on the app shell's layout load, because
 * in the layout it would add a D1 read and a few hundred bytes of ciphertext to
 * *every* page in the app for something needed once per lock.
 */
export const GET: RequestHandler = async ({ locals }) => {
	// Explicit, even though this sits under a directory that looks protected.
	// `src/routes/api/` is deliberately outside both route groups: a group guard
	// is a layout load, and layout loads never run for a `+server.ts` at all.
	// Putting these under (auth-required) would advertise protection that does
	// not exist — worse than having none, because the next reader would trust it.
	if (!locals.user) error(401, 'Not signed in');

	return json(await getUnlockBundle(locals.db, locals.user.id));
};
