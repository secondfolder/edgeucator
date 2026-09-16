import { error, json } from '@sveltejs/kit';
import { replySchema } from '$lib/schemas/messageForm';
import { createMediaStore } from '$lib/server/media/dev';
import { createNotifier } from '$lib/server/realtime/dev';
import { requireThreadMembership, sendMessage } from '$lib/server/messaging';
import type { RequestHandler } from './$types';
import { parseSend, sendFailureStatus } from '../../../send';

/** A reply to an existing thread. */
export const POST: RequestHandler = async (event) => {
	const { locals, params, request, platform } = event;
	if (!locals.user) error(401, 'Not signed in');

	// The thread id from the URL is re-joined against this partnership rather
	// than trusted. Without that, anyone in *any* partnership could post into
	// any thread by supplying their own partnership id.
	if (!(await requireThreadMembership(locals.db, params.id, params.threadId, locals.user.id))) {
		error(404, 'Not found');
	}

	const { form, attachments } = await parseSend(request);
	const parsed = replySchema.safeParse({
		ciphertext: form.get('ciphertext'),
		metadataCiphertext: form.get('metadataCiphertext')
	});
	if (!parsed.success) error(400, parsed.error.issues[0]?.message ?? 'Malformed message');

	const store = await createMediaStore({ platform });
	const result = await sendMessage(locals.db, store, {
		partnershipId: params.id,
		threadId: params.threadId,
		senderId: locals.user.id,
		ciphertext: parsed.data.ciphertext,
		metadataCiphertext: parsed.data.metadataCiphertext,
		attachments
	});

	if (!result.ok) error(sendFailureStatus(result.reason), result.reason);

	const notifier = await createNotifier({ platform });
	await notifier.publish(params.id, { kind: 'message', threadId: params.threadId });

	return json({ messageId: result.messageId }, { status: 201 });
};
