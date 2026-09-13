import { error } from '@sveltejs/kit';
import { MAX_ATTACHMENTS_PER_MESSAGE, MAX_ATTACHMENT_TOTAL_BYTES } from '$lib/messaging';
import type { OutgoingAttachment, SendFailure } from '$lib/server/messaging';

/**
 * The half of a send that both endpoints do identically: read the multipart
 * body, and turn a refusal into the right HTTP status.
 *
 * A shared module rather than a copy in each, because the cap checks are the
 * only thing standing between a 40 MB upload and a Worker isolate running out
 * of memory, and two copies of that would drift.
 */

/**
 * A little over the attachment budget, to leave room for the body and the
 * multipart framing without letting a genuinely enormous request through.
 */
export const MAX_REQUEST_BYTES = MAX_ATTACHMENT_TOTAL_BYTES + 1024 * 1024;

/** Attachment ids become primary keys and path segments, so nothing else. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type ParsedSend = {
	form: FormData;
	attachments: OutgoingAttachment[];
};

/**
 * Reads the request body, refusing anything oversized as early as it can.
 *
 * The `Content-Length` check happens BEFORE `request.formData()`, which buffers
 * the whole body against a 128 MB isolate. A client can under-report the header
 * but not over-report it, so this is a cheap early 413 for an honest 40 MB
 * upload rather than a security boundary — the authoritative check is the byte
 * sum afterwards.
 */
export async function parseSend(request: Request): Promise<ParsedSend> {
	const declared = Number(request.headers.get('content-length') ?? 0);
	if (declared > MAX_REQUEST_BYTES) {
		error(413, 'Those files add up to more than 25 MB.');
	}

	/**
	 * `formData()` throws a TypeError for a body that is not multipart or
	 * form-urlencoded — including no body at all — and an uncaught throw here is
	 * a 500 for what is plainly a malformed request. Found by a test that posted
	 * an empty body.
	 */
	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		error(400, 'Expected a multipart form body.');
	}

	const files = form.getAll('files').filter((value): value is File => value instanceof File);
	/**
	 * The row id for each file, in the same order, chosen by the client.
	 *
	 * See `OutgoingAttachment` for why the client has to own these: the
	 * decryption keys are inside the encrypted body, so the ids must exist
	 * before it is sealed. Validated as UUIDs so nothing else can end up as a
	 * primary key or, through `attachmentKey`, as part of a storage path.
	 */
	const ids = form.getAll('fileIds').map(String);
	if (ids.length !== files.length) {
		error(400, 'Each file needs exactly one id.');
	}
	if (!ids.every((id) => UUID.test(id))) {
		error(400, 'Malformed attachment id.');
	}
	if (new Set(ids).size !== ids.length) {
		error(400, 'Duplicate attachment id.');
	}

	if (files.length > MAX_ATTACHMENTS_PER_MESSAGE) {
		error(413, `A message can carry at most ${MAX_ATTACHMENTS_PER_MESSAGE} files.`);
	}
	const total = files.reduce((sum, file) => sum + file.size, 0);
	if (total > MAX_ATTACHMENT_TOTAL_BYTES) {
		error(413, 'Those files add up to more than 25 MB.');
	}

	return {
		form,
		// `.stream()` rather than `.arrayBuffer()`: formData has already buffered
		// once, and streaming into the store avoids a second full copy.
		attachments: files.map((file, index) => ({
			id: ids[index],
			body: file.stream(),
			byteSize: file.size
		}))
	};
}

/** Maps a refusal from the data layer onto a status a client can act on. */
export function sendFailureStatus(reason: SendFailure): number {
	switch (reason) {
		case 'not-a-member':
		case 'no-such-thread':
			// 404 and not 403, matching the partner routes: distinguishing them
			// would confirm the id is real.
			return 404;
		case 'bad-icon':
		case 'no-such-tag':
		case 'duplicate-attachment':
			return 400;
		default:
			return 413;
	}
}
