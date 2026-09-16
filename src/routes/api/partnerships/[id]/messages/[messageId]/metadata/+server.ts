import { error, json } from '@sveltejs/kit';
import { messageMetadataSchema } from '$lib/schemas/messageForm';
import { setMessageMetadataCiphertext } from '$lib/server/messaging';
import type { RequestHandler } from './$types';

/**
 * Updates a message's encrypted metadata sidecar once the client has resolved
 * valid preview data it wants to persist.
 */
export const PUT: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user) error(401, 'Not signed in');

	const parsed = messageMetadataSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, parsed.error.issues[0]?.message ?? 'Malformed metadata');

	const updated = await setMessageMetadataCiphertext(locals.db, {
		partnershipId: params.id,
		messageId: params.messageId,
		viewerId: locals.user.id,
		metadataCiphertext: parsed.data.metadataCiphertext
	});
	if (!updated) error(404, 'Not found');
	return json({ ok: true });
};
