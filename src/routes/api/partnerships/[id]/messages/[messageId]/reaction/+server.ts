import { error, json } from '@sveltejs/kit';
import { reactionSchema } from '$lib/schemas/messageForm';
import { clearReaction, setReaction } from '$lib/server/messaging';
import { createNotifier } from '$lib/server/realtime/dev';
import type { RequestHandler } from './$types';

/** Sets or replaces the viewer's tapback. One per person per message. */
export const PUT: RequestHandler = async ({ locals, params, request, platform }) => {
	if (!locals.user) error(401, 'Not signed in');

	const parsed = reactionSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, parsed.error.issues[0]?.message ?? 'Malformed reaction');

	const result = await setReaction(locals.db, {
		partnershipId: params.id,
		messageId: params.messageId,
		viewerId: locals.user.id,
		ciphertext: parsed.data.ciphertext
	});

	if (!result.ok) {
		// "Your own message" is a 409 rather than a 403: the request is
		// well-formed and authorised, it just conflicts with what a reaction is
		// for. The UI does not offer the control on your own bubbles anyway.
		error(result.reason === 'not-a-member' ? 404 : 409, result.reason);
	}

	const notifier = await createNotifier({ platform });
	await notifier.publish(params.id, { kind: 'reaction', threadId: result.threadId });

	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ locals, params, platform }) => {
	if (!locals.user) error(401, 'Not signed in');

	const result = await clearReaction(locals.db, {
		partnershipId: params.id,
		messageId: params.messageId,
		viewerId: locals.user.id
	});
	if (!result.ok) error(404, 'Not found');

	const notifier = await createNotifier({ platform });
	await notifier.publish(params.id, { kind: 'reaction', threadId: result.threadId });

	return json({ ok: true });
};
