import { error } from '@sveltejs/kit';
import { createMediaStore } from '$lib/server/media/dev';
import { getAttachmentForDownload, requireMembership } from '$lib/server/messaging';
import type { RequestHandler } from './$types';

/** Streams one encrypted attachment. The browser decrypts it. */
export const GET: RequestHandler = async ({ locals, params, platform }) => {
	if (!locals.user) error(401, 'Not signed in');
	if (!(await requireMembership(locals.db, params.id, locals.user.id))) error(404, 'Not found');

	// The attachment is re-joined through its message and thread to THIS
	// partnership, not just looked up by id. Without that join, anyone in any
	// partnership could read any attachment by putting their own id in the path
	// — the confused deputy this feature is most likely to ship with.
	const row = await getAttachmentForDownload(locals.db, params.id, params.attachmentId);
	if (!row) error(404, 'Not found');

	const store = await createMediaStore({ platform });
	const object = await store.get(row.storageKey);
	// A row with no object is the orphan case in the other direction — a purge
	// that half-ran. 404 rather than 500: there is nothing to retry.
	if (!object) error(404, 'Not found');

	return new Response(object.body, {
		headers: {
			// Opaque on purpose. The real type and filename are inside the
			// ciphertext, so the server cannot state either — and must not guess,
			// because a wrong Content-Type is how a browser gets talked into
			// sniffing an encrypted blob as something executable.
			'content-type': 'application/octet-stream',
			'content-length': String(object.byteSize),
			'x-content-type-options': 'nosniff',
			// Immutable content at a UUID address. `private` because the response
			// is membership-gated and must never enter a shared cache.
			'cache-control': 'private, max-age=31536000, immutable',
			etag: `"${row.id}"`
			// No Range support: age ciphertext is not seekable, so a partial
			// response would be useless. This is why a video is downloaded in full
			// before it plays, and why MAX_VIDEO_BYTES is below the message cap.
		}
	});
};
