import { describe, expect, it } from 'vitest';
import { MAX_BODY_CHARS } from '../messaging';
import { generateAgeIdentity, importIdentityKey } from './identity';
import {
	decryptAttachment,
	decryptPayload,
	encryptAttachment,
	encryptPayload,
	normaliseBody,
	type MessagePayload,
	type ReactionPayload
} from './messages';

const payload = (text: string): MessagePayload => ({ version: 1, text, attachments: [] });

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
	const chunks: Uint8Array[] = [];
	const reader = stream.getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
	}
	const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
	let at = 0;
	for (const chunk of chunks) {
		out.set(chunk, at);
		at += chunk.length;
	}
	return out;
}

describe('encryptPayload / decryptPayload', () => {
	/** The shape every message in the feature has. */
	it('lets both partners open one ciphertext, and nobody else', async () => {
		const ada = await generateAgeIdentity();
		const jun = await generateAgeIdentity();
		const stranger = await generateAgeIdentity();

		const ciphertext = await encryptPayload(payload('meet me in the kitchen'), [
			ada.recipient,
			jun.recipient
		]);

		for (const identity of [ada.identity, jun.identity]) {
			await expect(decryptPayload(ciphertext, identity)).resolves.toEqual(
				payload('meet me in the kitchen')
			);
		}
		// Null, not a throw: a board can hold messages from before a key change,
		// and the UI renders those as "ask your partner to restore this".
		await expect(decryptPayload(ciphertext, stranger.identity)).resolves.toBeNull();
	});

	it('works with the cached non-extractable CryptoKey', async () => {
		const ada = await generateAgeIdentity();
		const ciphertext = await encryptPayload(payload('from a real device'), [ada.recipient]);
		const key = await importIdentityKey(ada.identity);
		await expect(decryptPayload(ciphertext, key)).resolves.toEqual(payload('from a real device'));
	});

	it('emits base64 that the ciphertext column accepts', async () => {
		const ada = await generateAgeIdentity();
		const ciphertext = await encryptPayload(payload('hi'), [ada.recipient]);
		// The Zod field's charset. base64url would be wrong here.
		expect(ciphertext).toMatch(/^[A-Za-z0-9+/=]+$/);
	});

	it('carries no plaintext', async () => {
		const ada = await generateAgeIdentity();
		const ciphertext = await encryptPayload(payload('a very distinctive phrase'), [ada.recipient]);
		expect(ciphertext).not.toContain('distinctive');
		expect(atob(ciphertext)).not.toContain('distinctive');
	});

	it('round-trips the attachment manifest, keys and all', async () => {
		const ada = await generateAgeIdentity();
		const file = await generateAgeIdentity();
		const full: MessagePayload = {
			version: 1,
			text: 'look',
			attachments: [
				{
					id: crypto.randomUUID(),
					key: file.identity,
					kind: 'image',
					mimeType: 'image/png',
					fileName: 'sunset.png'
				}
			]
		};
		const ciphertext = await encryptPayload(full, [ada.recipient]);
		await expect(decryptPayload(ciphertext, ada.identity)).resolves.toEqual(full);
	});

	it('handles a reaction payload', async () => {
		const ada = await generateAgeIdentity();
		const reaction: ReactionPayload = { version: 1, emoji: '🔥' };
		const ciphertext = await encryptPayload(reaction, [ada.recipient]);
		await expect(decryptPayload<ReactionPayload>(ciphertext, ada.identity)).resolves.toEqual(
			reaction
		);
	});

	it('needs at least one recipient', async () => {
		await expect(encryptPayload(payload('x'), [])).rejects.toThrow(/at least one recipient/);
	});

	// Happens naturally if someone ever messages themselves; two identical
	// header stanzas would be pointless rather than harmful, but still wrong.
	it('deduplicates recipients', async () => {
		const ada = await generateAgeIdentity();
		const once = await encryptPayload(payload('x'), [ada.recipient]);
		const twice = await encryptPayload(payload('x'), [ada.recipient, ada.recipient]);
		expect(atob(twice).length).toBe(atob(once).length);
	});

	it('returns null for a body that is not a valid age file', async () => {
		const ada = await generateAgeIdentity();
		await expect(decryptPayload('bm90IGFuIGFnZSBmaWxl', ada.identity)).resolves.toBeNull();
	});

	it('survives a multi-byte body', async () => {
		const ada = await generateAgeIdentity();
		const text = 'naïve 🔐 — “curly” … 日本語';
		const ciphertext = await encryptPayload(payload(text), [ada.recipient]);
		await expect(decryptPayload(ciphertext, ada.identity)).resolves.toEqual(payload(text));
	});
});

describe('normaliseBody', () => {
	it('trims trailing whitespace only', () => {
		// Leading indentation can be deliberate in a long message.
		expect(normaliseBody('  hello  \n\n')).toBe('  hello');
	});

	it('keeps interior newlines, which are what the user typed', () => {
		expect(normaliseBody('one\n\ntwo')).toBe('one\n\ntwo');
	});

	it('bounds the length', () => {
		expect(normaliseBody('x'.repeat(MAX_BODY_CHARS + 500))).toHaveLength(MAX_BODY_CHARS);
	});
});

describe('attachments', () => {
	/**
	 * Each file gets its own ephemeral identity, carried in the message body.
	 * That is what makes a history restore re-encrypt kilobytes instead of
	 * re-uploading megabytes.
	 */
	it('encrypts under a per-file key and decrypts back to the same bytes', async () => {
		const bytes = crypto.getRandomValues(new Uint8Array(40_000));
		const file = new File([bytes as BlobPart], 'clip.mp4', { type: 'video/mp4' });

		const encrypted = await encryptAttachment(file);
		const ciphertext = await collect(encrypted.body);

		// The declared size has to be right: R2 is given a length up front.
		expect(ciphertext.length).toBe(encrypted.byteSize);
		expect(ciphertext.length).toBeGreaterThan(bytes.length);

		const blob = await decryptAttachment(ciphertext.buffer as ArrayBuffer, {
			id: 'a',
			key: encrypted.key,
			kind: 'video',
			mimeType: 'video/mp4',
			fileName: 'clip.mp4'
		});
		expect(blob.type).toBe('video/mp4');
		expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
	});

	it('gives every file a different key', async () => {
		const file = new File([new Uint8Array(10) as BlobPart], 'a.png', { type: 'image/png' });
		const a = await encryptAttachment(file);
		const b = await encryptAttachment(file);
		expect(a.key).not.toBe(b.key);
	});

	it('cannot be opened with another file’s key', async () => {
		const bytes = crypto.getRandomValues(new Uint8Array(1024));
		const a = await encryptAttachment(
			new File([bytes as BlobPart], 'a.png', { type: 'image/png' })
		);
		const b = await encryptAttachment(
			new File([bytes as BlobPart], 'b.png', { type: 'image/png' })
		);
		const ciphertext = await collect(a.body);

		await expect(
			decryptAttachment(ciphertext.buffer as ArrayBuffer, {
				id: 'a',
				key: b.key,
				kind: 'image',
				mimeType: 'image/png',
				fileName: 'a.png'
			})
		).rejects.toThrow();
	});

	it('handles an empty file without breaking the size calculation', async () => {
		const encrypted = await encryptAttachment(new File([], 'empty.png', { type: 'image/png' }));
		const ciphertext = await collect(encrypted.body);
		expect(ciphertext.length).toBe(encrypted.byteSize);
	});
});
