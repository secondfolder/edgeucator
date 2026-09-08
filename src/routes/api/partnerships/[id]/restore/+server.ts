import { error, json } from '@sveltejs/kit';
import { restoreApplySchema, restoreDeclineSchema } from '$lib/schemas/messageForm';
import {
	applyHistoryRestore,
	declineHistoryRestore,
	listHistoryForRestore
} from '$lib/server/messaging';
import type { RequestHandler } from './$types';

/**
 * Partner-assisted history restore.
 *
 * Outside both route groups on purpose — see AGENTS.md. A group guard is a
 * layout load, and layout loads never run for a `+server.ts`, so every handler
 * here opens with its own `locals.user` check and the membership test lives in
 * `server/messaging.ts`.
 *
 * What this endpoint hands over is unusual enough to state plainly: `GET`
 * returns the *entire* shared history of a partnership, as ciphertext, to the
 * member who is re-encrypting it. That is safe only because it goes to somebody
 * who can already decrypt all of it — they are one of the two recipients on
 * every message. The gate is therefore not "are you a member" but "are you the
 * member who did *not* raise this request", which `listHistoryForRestore`
 * checks against the request row rather than trusting the caller.
 */

/** A page of ciphertext to re-encrypt. `cursor` comes from the previous page. */
export const GET: RequestHandler = async ({ locals, params, url }) => {
	if (!locals.user) error(401, 'Not signed in');

	const requestId = url.searchParams.get('requestId');
	if (!requestId) error(400, 'Which request?');

	const page = await listHistoryForRestore(locals.db, {
		partnershipId: params.id,
		requestId,
		actorId: locals.user.id,
		cursor: url.searchParams.get('cursor')
	});

	// 404 for "not a member", "no such request" and "that request is yours" all
	// alike: distinguishing them would confirm which partnerships and requests
	// exist, and the client has nothing different to do in any of the cases.
	if (!page) error(404, 'Not found');
	return json(page);
};

/** Writes back one page of re-encrypted bodies. */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user) error(401, 'Not signed in');

	const parsed = restoreApplySchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, parsed.error.issues[0]?.message ?? 'Malformed restore');

	const result = await applyHistoryRestore(locals.db, {
		partnershipId: params.id,
		requestId: parsed.data.requestId,
		actorId: locals.user.id,
		messages: parsed.data.messages,
		reactions: parsed.data.reactions,
		final: parsed.data.final
	});

	if (!result.ok) error(404, 'Not found');
	return json({ ok: true, updated: result.updated });
};

/**
 * Refuses a request.
 *
 * A real answer, not just tidiness: the partner comparing the safety number is
 * the load-bearing step in this flow, and someone who finds it does **not**
 * match needs a way to say so that leaves the requester informed rather than
 * waiting indefinitely.
 */
export const DELETE: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user) error(401, 'Not signed in');

	const parsed = restoreDeclineSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, parsed.error.issues[0]?.message ?? 'Malformed request');

	const done = await declineHistoryRestore(locals.db, {
		partnershipId: params.id,
		requestId: parsed.data.requestId,
		actorId: locals.user.id
	});
	if (!done) error(404, 'Not found');
	return json({ ok: true });
};
