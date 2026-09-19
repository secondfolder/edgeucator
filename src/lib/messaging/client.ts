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
	MAX_BODY_CHARS,
	MAX_VIDEO_BYTES
} from '$lib/messaging';
import {
	documentEmbedUrls,
	documentToPlainText,
	isRichTextDocumentEmpty,
	parseStoredRichText
} from '$lib/richtext';
import {
	decryptAttachment,
	decryptMessageMetadata,
	decryptPayload,
	encryptAttachment,
	encryptMessageMetadata,
	encryptPayload,
	type MessageAttachmentInfo,
	type MessageMetadataPayload,
	type MessagePayload,
	type ReactionPayload
} from '$lib/crypto/messages';
import { type CachedEmbedDetails } from '$lib/embeds';

export type ComposedMessage = {
	text: string;
	files: File[];
};

/** A refusal the composer can render, worked out before anything is sent. */
export type ComposeProblem = {
	kind: 'empty' | 'too-long' | 'too-many' | 'too-big' | 'video-too-big';
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
	/**
	 * Emptiness and length are both measured on the *visible text*, never on the
	 * stored string. The stored string is a Lexical document — JSON several
	 * times the size of the prose it carries — so counting it would call an
	 * empty editor full and cut people off after a few hundred typed
	 * characters.
	 */
	const document = parseStoredRichText(message.text);
	if (isRichTextDocumentEmpty(document) && message.files.length === 0) {
		return { kind: 'empty', message: 'Write something first' };
	}
	if (documentToPlainText(document).length > MAX_BODY_CHARS) {
		// Refused rather than truncated: a document cannot be cut at a character
		// offset without corrupting it, and silently dropping the end of
		// somebody's message is worse than asking them to shorten it.
		return {
			kind: 'too-long',
			message: `That message is over the ${MAX_BODY_CHARS.toLocaleString()} character limit`
		};
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
	// Already canonical: the editor serialises through the same schema the
	// reader validates with, so there is nothing left to normalise.
	const text = message.text;
	const metadataPromise = resolveMessageMetadata(text);

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
		text,
		attachments
	};
	body.set('ciphertext', await encryptPayload(payload, recipients));
	const metadata = await metadataPromise.catch(() => null);
	if (metadata) {
		body.set('metadataCiphertext', await encryptMessageMetadata(metadata, recipients));
	}
	return body;
}

/**
 * The URLs whose embed metadata is worth caching with the message.
 *
 * Exactly the document's embed nodes. Because an embed is an explicit node
 * rather than something re-derived from the prose, the set cached here cannot
 * drift from the set the reader later draws — which is what the old
 * `findRenderableLinks` arrangement had to guarantee by convention.
 */
function embeddableUrls(text: string): string[] {
	return documentEmbedUrls(parseStoredRichText(text));
}

async function resolveEmbedMetadata(urls: string[]): Promise<CachedEmbedDetails[]> {
	if (urls.length === 0) return [];

	const response = await fetch('/api/embed-metadata', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ urls })
	});
	if (!response.ok) return [];
	const result = (await response.json()) as { embeds?: CachedEmbedDetails[] };
	return Array.isArray(result.embeds) ? result.embeds : [];
}

async function resolveMessageMetadata(text: string): Promise<MessageMetadataPayload | null> {
	const urls = embeddableUrls(text);
	const embeds = await resolveEmbedMetadata(urls);
	if (embeds.length === 0) return null;
	return { version: 1, embeds };
}

export type SendTarget =
	| { kind: 'new-thread'; partnershipId: string; tagIds?: string[] }
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
	if (target.kind === 'new-thread') {
		body.set('icon', DEFAULT_THREAD_ICON);
		body.set('tagIds', JSON.stringify(target.tagIds ?? []));
	}

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

export async function openMessageMetadata(
	ciphertext: string,
	identity: CryptoKey | string
): Promise<MessageMetadataPayload | null> {
	return decryptMessageMetadata(ciphertext, identity);
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

export async function fillMissingMessageMetadata(
	partnershipId: string,
	messageId: string,
	href: string,
	current: MessageMetadataPayload | null,
	recipients: string[]
): Promise<MessageMetadataPayload | null> {
	if (recipients.length === 0) return null;
	if (current?.embeds.some((embed) => embed.href === href)) return current;

	return writeMessageMetadataEntry(partnershipId, messageId, href, current, recipients, false);
}

export async function refreshMessageMetadata(
	partnershipId: string,
	messageId: string,
	href: string,
	current: MessageMetadataPayload | null,
	recipients: string[]
): Promise<MessageMetadataPayload | null> {
	if (recipients.length === 0) return null;
	return writeMessageMetadataEntry(partnershipId, messageId, href, current, recipients, true);
}

async function writeMessageMetadataEntry(
	partnershipId: string,
	messageId: string,
	href: string,
	current: MessageMetadataPayload | null,
	recipients: string[],
	replaceExisting: boolean
): Promise<MessageMetadataPayload | null> {
	const embeds = await resolveEmbedMetadata([href]);
	const embed = embeds.find((entry) => entry.href === href) ?? null;
	if (!embed) return null;
	const existing = current?.embeds ?? [];
	const present = existing.some((entry) => entry.href === href);
	if (present && !replaceExisting) return current;

	const metadata: MessageMetadataPayload = {
		version: 1,
		embeds: present
			? existing.map((entry) => (entry.href === href ? embed : entry))
			: [...existing, embed]
	};

	const metadataCiphertext = await encryptMessageMetadata(metadata, recipients);
	const response = await fetch(
		`/api/partnerships/${partnershipId}/messages/${messageId}/metadata`,
		{
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ metadataCiphertext })
		}
	);
	if (!response.ok) return null;
	return metadata;
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

/** Stores whether this account wants message-thread URL embeds to load automatically. */
export async function saveEmbedAutoLoadPreference(enabled: boolean): Promise<boolean> {
	const response = await fetch('/api/account/embed-auto-load', {
		method: 'POST',
		keepalive: true,
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ enabled })
	});
	if (!response.ok) return false;
	const result = (await response.json().catch(() => null)) as { ok?: boolean } | null;
	return result?.ok === true;
}
