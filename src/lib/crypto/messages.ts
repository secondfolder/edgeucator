/**
 * Encrypting and decrypting a message.
 *
 * BROWSER ONLY — see the note at the top of `kdf.ts`.
 *
 * A message body is an age file encrypted to **both** partners, so each of them
 * can open it independently and the server can hold the only copy without being
 * able to read it. That is also what makes the history restorable on a new
 * device: there is no ratchet to have moved on.
 *
 * The plaintext is JSON rather than a bare string, because a message is not only
 * text — it carries the attachment manifest, and each attachment's own key. See
 * `MessagePayload`.
 */

import { MAX_BODY_CHARS } from '../messaging';
import type { CachedEmbedDetails } from '../embeds';
import { loadAge } from './identity';

/**
 * What is actually inside the ciphertext.
 *
 * `attachments` carries a *key per file*, and that indirection is the whole
 * reason partner-assisted recovery is affordable: each file is encrypted under
 * its own ephemeral age identity, so re-encrypting these few kilobytes restores
 * access to megabytes in the object store without touching them.
 *
 * `version` is here so a later shape can be told apart from this one by a
 * client that has already downloaded the history.
 */
export type MessagePayload = {
	version: 1;
	text: string;
	attachments: MessageAttachmentInfo[];
};

export type MessageMetadataPayload = {
	version: 1;
	embeds: CachedEmbedDetails[];
};

export type MessageAttachmentInfo = {
	/** The `message_attachments.id` the server assigned. */
	id: string;
	/** The ephemeral `AGE-SECRET-KEY-1…` that opens this file, and only this file. */
	key: string;
	/** For choosing between <img> and <video>, and for the download name. */
	kind: 'image' | 'video';
	mimeType: string;
	fileName: string;
};

/** A reaction's plaintext. Its own type so a stray string cannot be stored. */
export type ReactionPayload = { version: 1; emoji: string };

const encoder = new TextEncoder();

function encodeBase64(bytes: Uint8Array): string {
	// Standard base64 here, not base64url: this is what goes in a `ciphertext`
	// column, and the Zod field checks `[A-Za-z0-9+/=]`. base64url is reserved
	// for values that travel in a URL.
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

/** Encrypts a payload to every given recipient. Both partners, in practice. */
export async function encryptPayload(
	payload: MessagePayload | MessageMetadataPayload | ReactionPayload,
	recipients: string[]
): Promise<string> {
	if (recipients.length === 0) throw new Error('A message needs at least one recipient');

	const age = await loadAge();
	const encrypter = new age.Encrypter();
	// Deduplicated because encrypting to the same recipient twice would put two
	// identical stanzas in the header for no reason — and it happens naturally
	// if someone ever messages themselves.
	for (const recipient of [...new Set(recipients)]) encrypter.addRecipient(recipient);

	return encodeBase64(await encrypter.encrypt(encoder.encode(JSON.stringify(payload))));
}

/**
 * Opens a message body, or returns null when this identity cannot.
 *
 * Null rather than a throw for "not for me", because a board can legitimately
 * contain messages from before a key was replaced — the UI renders those as
 * "ask your partner to restore this" rather than as a failure. age throws for
 * that case, so it is caught and converted here, once.
 */
export async function decryptPayload<T = MessagePayload>(
	ciphertext: string,
	identity: CryptoKey | string
): Promise<T | null> {
	const age = await loadAge();
	const decrypter = new age.Decrypter();
	decrypter.addIdentity(identity);

	try {
		const opened = await decrypter.decrypt(decodeBase64(ciphertext), 'text');
		return JSON.parse(opened) as T;
	} catch {
		return null;
	}
}

export async function encryptMessageMetadata(
	payload: MessageMetadataPayload,
	recipients: string[]
): Promise<string> {
	return encryptPayload(payload, recipients);
}

export async function decryptMessageMetadata(
	ciphertext: string,
	identity: CryptoKey | string
): Promise<MessageMetadataPayload | null> {
	return decryptPayload<MessageMetadataPayload>(ciphertext, identity);
}

/** Trims and bounds what the composer collected, before it is encrypted. */
export function normaliseBody(text: string): string {
	// Trailing whitespace only: leading indentation can be deliberate in a long
	// message, and collapsing interior newlines would rewrite what was typed.
	return text.replace(/\s+$/, '').slice(0, MAX_BODY_CHARS);
}

// ── attachments ──────────────────────────────────────────────────────────────

/**
 * Encrypts one file under a fresh identity of its own.
 *
 * Streamed rather than buffered, so a 15 MB video is not held twice in memory
 * on the way out. The returned `key` goes inside the message body; the bytes go
 * to the object store.
 */
export async function encryptAttachment(file: File): Promise<{
	key: string;
	body: ReadableStream<Uint8Array>;
	byteSize: number;
}> {
	const age = await loadAge();
	// A per-file identity, not the partners' keys. See MessagePayload for why:
	// it is what lets a history restore re-encrypt only the bodies.
	const key = await age.generateX25519Identity();
	const encrypter = new age.Encrypter();
	encrypter.addRecipient(await age.identityToRecipient(key));

	const stream = await encrypter.encrypt(file.stream());
	return {
		key,
		body: stream,
		// R2 needs a length up front, and age's own size() converts a plaintext
		// size into the ciphertext size it will produce.
		byteSize: stream.size(file.size)
	};
}

/** Decrypts a downloaded attachment into a blob the page can show. */
export async function decryptAttachment(
	ciphertext: ArrayBuffer,
	info: MessageAttachmentInfo
): Promise<Blob> {
	const age = await loadAge();
	const decrypter = new age.Decrypter();
	decrypter.addIdentity(info.key);
	const bytes = await decrypter.decrypt(new Uint8Array(ciphertext), 'uint8array');
	return new Blob([bytes as BlobPart], { type: info.mimeType });
}
