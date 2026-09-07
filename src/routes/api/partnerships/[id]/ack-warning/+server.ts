import { error, json } from '@sveltejs/kit';
import { acknowledgeHistoryWarning } from '$lib/server/keys';
import type { RequestHandler } from './$types';

/**
 * Records that the user has read and accepted the "lose your password, lose
 * your history" warning.
 *
 * Stored server-side rather than in localStorage because the thing being
 * acknowledged is the loss of every message on every device — it should not be
 * dismissible by clearing site data or by picking up a different phone.
 *
 * Keyed on the partnership only because that is the URL the board lives at; the
 * acknowledgement itself is per user.
 */
export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401, 'Not signed in');
	await acknowledgeHistoryWarning(locals.db, locals.user.id);
	return json({ ok: true });
};
