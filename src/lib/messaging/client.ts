/**
 * Sending and reading messages from the browser.
 *
 * The seam between the encryption in `src/lib/crypto/` and the endpoints under
 * `src/routes/api/`. Everything here runs in the browser: it has to, because
 * the request body is ciphertext only the browser can produce.
 */

import {
	DEFAULT_THREAD_ICON,
	MAX_ATTACHMENTS_PER_MESSAGE,
	MAX_ATTACHMENT_TOTAL_BYTES,
	MAX_VIDEO_BYTES
} from '$lib/messaging';
import {
	decryptAttachment,
	decryptPayload,
	encryptAttachment,
	encryptPayload,
	normaliseBody,
	type MessageAttachmentInfo,
	type MessagePayload,
	type ReactionPayload
} from '$lib/crypto/messages';

export type ComposedMessage = {
	text: string;
	files: File[];
};

/** A refusal the composer can render, worked out before anything is sent. */
export type ComposeProblem = {
	kind: 'empty' | 'too-many' | 'too-big' | 'video-too-big';
	message: string;
};

/**
 * Checks what the composer collected, before encrypting or uploading anything.
 *
 * The same limits the endpoint enforces, checked here so a 25 MB refusal costs
 * nothing. The server's copy is the one that counts; this one is a courtesy —
 * see the note in `src/lib/schemas/messageForm.ts`.
 */
export function checkComposed(message: ComposedMessage): ComposeProblem | null {
	if (normaliseBody(message.text).length === 0 && message.files.length === 0) {
		return { kind: 'empty', message: 'Write something first' };
	}
	if (message.files.length > MAX_ATTACHMENTS_PER_MESSAGE) {
		return {
			kind: 'too-many',
			message: `At most ${MAX_ATTACHMENTS_PER_MESSAGE} files in one message`
		};
	}
	const oversizedVideo = message.files.find(
		(file) => file.type.startsWith('video/') && file.size > MAX_VIDEO_BYTES
	);
	if (oversizedVideo) {
		return {
			kind: 'video-too-big',
			message: `Videos have to be under ${Math.round(MAX_VIDEO_BYTES / 1024 / 1024)} MB — they are downloaded in full before they play`
		};
	}
	const total = message.files.reduce((sum, file) => sum + file.size, 0);
	if (total > MAX_ATTACHMENT_TOTAL_BYTES) {
		return {
			kind: 'too-big',
			message: `Those files add up to more than ${Math.round(MAX_ATTACHMENT_TOTAL_BYTES / 1024 / 1024)} MB`
		};
	}
	return null;
}

function kindOf(file: File): 'image' | 'video' {
	return file.type.startsWith('video/') ? 'video' : 'image';
}

/**
 * Encrypts a message and its files into a body ready to post.
 *
 * Each file is sealed under its own ephemeral identity, and that identity goes
 * into the manifest *inside* the encrypted body — see `MessagePayload`.
 *
 * Which is why the ids are generated here rather than by the server: the
 * manifest has to name them before it is sealed, and asking the server first
 * would mean either a second round trip to re-seal the body or an unencrypted
 * manifest. They travel alongside as `fileIds`, in the same order as the files,
 * and the endpoint validates them.
 */
async function buildBody(message: ComposedMessage, recipients: string[]): Promise<FormData> {
	const attachments: MessageAttachmentInfo[] = [];
	const body = new FormData();

	for (const file of message.files) {
		const sealed = await encryptAttachment(file);
		const id = crypto.randomUUID();
		attachments.push({
			id,
			key: sealed.key,
			kind: kindOf(file),
			mimeType: file.type || 'application/octet-stream',
			fileName: file.name
		});
		// A Blob, not the stream: FormData cannot carry a ReadableStream.
		body.append('files', new Blob([await new Response(sealed.body).arrayBuffer()]), file.name);
		// Appended in lockstep with the file above; order is what pairs them.
		body.append('fileIds', id);
	}

	const payload: MessagePayload = {
		version: 1,
		text: normaliseBody(message.text),
		attachments
	};
	body.set('ciphertext', await encryptPayload(payload, recipients));
	return body;
}

export type SendTarget =
	| { kind: 'new-thread'; partnershipId: string }
	| { kind: 'reply'; partnershipId: string; threadId: string };

export type SendOutcome =
	{ ok: true; threadId: string; messageId: string } | { ok: false; message: string };

function endpointFor(target: SendTarget): string {
	return target.kind === 'new-thread'
		? `/api/partnerships/${target.partnershipId}/threads`
		: `/api/partnerships/${target.partnershipId}/threads/${target.threadId}/messages`;
}

export async function sendMessage(
	target: SendTarget,
	message: ComposedMessage,
	recipients: string[]
): Promise<SendOutcome> {
	const problem = checkComposed(message);
	if (problem) return { ok: false, message: problem.message };
	if (recipients.length === 0) {
		return { ok: false, message: 'Your partner has not set up encrypted messaging yet' };
	}

	const body = await buildBody(message, recipients);
	if (target.kind === 'new-thread') body.set('icon', DEFAULT_THREAD_ICON);

	const response = await fetch(endpointFor(target), { method: 'POST', body });
	if (!response.ok) {
		return { ok: false, message: await describeFailure(response) };
	}

	const result = (await response.json()) as { threadId?: string; messageId: string };
	return {
		ok: true,
		threadId: target.kind === 'reply' ? target.threadId : (result.threadId ?? ''),
		messageId: result.messageId
	};
}

async function describeFailure(response: Response): Promise<string> {
	if (response.status === 413) return 'That is too large to send';
	if (response.status === 404) return 'That conversation is no longer there';
	if (response.status === 401) return 'You have been signed out';
	// SvelteKit's `error()` bodies are JSON with a `message`.
	const body = (await response.json().catch(() => null)) as { message?: string } | null;
	return body?.message ?? 'Could not send that';
}

// ── reading ──────────────────────────────────────────────────────────────────

export type DecryptedMessage = {
	/** Null when this identity cannot open it — see `openMessage`. */
	payload: MessagePayload | null;
};

/**
 * Opens a message body.
 *
 * A null payload is not an error: a board can hold messages encrypted to a key
 * the user no longer has, if their password was reset. The UI renders those as
 * "ask your partner to restore this" rather than as a failure.
 */
export async function openMessage(
	ciphertext: string,
	identity: CryptoKey | string
): Promise<MessagePayload | null> {
	return decryptPayload<MessagePayload>(ciphertext, identity);
}

export async function openReaction(
	ciphertext: string,
	identity: CryptoKey | string
): Promise<string | null> {
	const payload = await decryptPayload<ReactionPayload>(ciphertext, identity);
	return payload?.emoji ?? null;
}

export async function buildReaction(emoji: string, recipients: string[]): Promise<string> {
	return encryptPayload({ version: 1, emoji }, recipients);
}

/**
 * Downloads and decrypts one attachment into an object URL.
 *
 * The caller owns the URL and must revoke it — `AttachmentPreview` does that on
 * destroy. Downloaded in full before anything can be shown, because age
 * ciphertext is not seekable; that is why videos are capped lower than the
 * message budget.
 */
export async function fetchAttachment(
	partnershipId: string,
	info: MessageAttachmentInfo
): Promise<{ url: string; blob: Blob }> {
	const response = await fetch(`/api/partnerships/${partnershipId}/attachments/${info.id}`);
	if (!response.ok) throw new Error(`Could not download attachment (${response.status})`);
	const blob = await decryptAttachment(await response.arrayBuffer(), info);
	return { url: URL.createObjectURL(blob), blob };
}

/** Records the history-warning acknowledgement. */
export async function acknowledgeWarning(partnershipId: string): Promise<void> {
	await fetch(`/api/partnerships/${partnershipId}/ack-warning`, { method: 'POST' });
}
