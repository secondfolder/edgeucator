import { error, json } from '@sveltejs/kit';
import { legacyBodiesSchema } from '$lib/schemas/messageForm';
import { migrateMessageBodies } from '$lib/server/messaging';
import type { RequestHandler } from './$types';

/**
 * LEGACY-RICHTEXT — accepts converted copies of the caller's own pre-rich-text
 * message bodies.
 *
 * This endpoint and its route directory are deleted once nothing is left at
 * `body_format = 'plain'`; see docs/temporary-code.md.
 *
 * It looks alarming — a client replacing stored message bodies — so note what
 * bounds it, all enforced in SQL by `migrateMessageBodies` rather than here:
 * the caller may only rewrite rows they sent, only rows still marked `'plain'`,
 * and only rows inside this partnership. It is therefore strictly one-way and
 * cannot become an "edit any message I sent" backdoor.
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user) error(401, 'Not signed in');

	const parsed = legacyBodiesSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, parsed.error.issues[0]?.message ?? 'Malformed request');

	const outcome = await migrateMessageBodies(locals.db, {
		partnershipId: params.id,
		actorId: locals.user.id,
		messages: parsed.data.messages
	});
	if (!outcome.ok) error(outcome.reason === 'not-a-member' ? 404 : 400, 'Cannot migrate');
	return json({ ok: true, updated: outcome.updated });
};
