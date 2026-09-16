import { error, json } from '@sveltejs/kit';
import { newThreadSchema } from '$lib/schemas/messageForm';
import { createMediaStore } from '$lib/server/media/dev';
import { createNotifier } from '$lib/server/realtime/dev';
import { requireMembership, startThread } from '$lib/server/messaging';
import type { RequestHandler } from './$types';
import { parseSend, sendFailureStatus } from '../send';

/**
 * Starts a thread: its sticker, its first message, and any attachments.
 *
 * One request for the whole message rather than an upload-then-link pair, so
 * there is no window in which a half-sent message exists. The cost is that
 * `request.formData()` buffers everything — hence the caps in `parseSend`.
 */
export const POST: RequestHandler = async (event) => {
	const { locals, params, request, platform } = event;
	// `src/routes/api/` sits outside both route groups on purpose: a group guard
	// is a layout load, and layout loads never run for a `+server.ts`. So every
	// handler carries its own check. See src/routes/api/keys/unlock-bundle.
	if (!locals.user) error(401, 'Not signed in');

	// Membership before the body is read, so a stranger cannot make the server
	// buffer 25 MB for them.
	if (!(await requireMembership(locals.db, params.id, locals.user.id))) {
		error(404, 'Not found');
	}

	const { form, attachments } = await parseSend(request);
	const parsed = newThreadSchema.safeParse({
		icon: form.get('icon'),
		ciphertext: form.get('ciphertext'),
		metadataCiphertext: form.get('metadataCiphertext')
	});
	if (!parsed.success) error(400, parsed.error.issues[0]?.message ?? 'Malformed message');
	const rawTagIds = form.get('tagIds');
	let tagIds: string[] = [];
	if (rawTagIds !== null) {
		try {
			const parsedTagIds: unknown = JSON.parse(String(rawTagIds));
			if (!Array.isArray(parsedTagIds) || !parsedTagIds.every((id) => typeof id === 'string')) {
				error(400, 'Malformed tag ids');
			}
			tagIds = parsedTagIds;
		} catch {
			error(400, 'Malformed tag ids');
		}
	}

	const store = await createMediaStore({ platform });
	const result = await startThread(locals.db, store, {
		partnershipId: params.id,
		senderId: locals.user.id,
		icon: parsed.data.icon,
		ciphertext: parsed.data.ciphertext,
		metadataCiphertext: parsed.data.metadataCiphertext,
		attachments,
		tagIds
	});

	if (!result.ok) error(sendFailureStatus(result.reason), result.reason);

	// After the write, and awaited but unable to fail — `publish` swallows its
	// own errors, because the message is already stored and a fan-out problem
	// must not turn into a retryable 500 for a send that worked.
	const notifier = await createNotifier({ platform });
	await notifier.publish(params.id, { kind: 'thread', threadId: result.threadId });

	return json({ threadId: result.threadId, messageId: result.messageId }, { status: 201 });
};
