import { encryptPayload, type MessagePayload } from '$lib/crypto/messages';
import { legacyTextToDocument } from '$lib/richtext-legacy';
import { looksLikeRichTextDocument } from '$lib/richtext';

/**
 * TEMPORARY — converts content written before rich text and writes it back.
 *
 * The whole file is deleted once nothing legacy is left; see
 * docs/temporary-code.md for the removal contract and how to tell when that
 * is. Every call site outside this file carries a `LEGACY-RICHTEXT` comment.
 *
 * Why the client does this at all, rather than a migration script: **message
 * bodies are E2E encrypted**, so the server cannot read them, cannot convert
 * them, and never will be able to. The only place a body can be converted is a
 * browser holding the key. Descriptions are different — the server does hold
 * those in plaintext — but they go through the same shape here so there is one
 * thing to delete rather than two.
 */

/** One candidate: a message, paired with its decrypted body. */
export type LegacyMessageEntry = {
	id: string;
	/** `undefined` while decrypting, `null` when the key is gone. */
	payload: MessagePayload | null | undefined;
};

/**
 * Convert and re-encrypt the viewer's own legacy messages.
 *
 * Silent by design: this is housekeeping the user did not ask for, so a
 * failure must never interrupt reading a thread. It returns the number written
 * so a test can assert on it.
 *
 * Only messages **the viewer sent** are migrated, which keeps one writer per
 * row — two clients cannot race over the same message — and matches what the
 * endpoint will accept anyway.
 */
export async function migrateLegacyMessages(input: {
	partnershipId: string;
	/**
	 * Already filtered to the viewer's own `'plain'` messages by the caller,
	 * which reads that state untracked — see the note at the call site.
	 */
	entries: LegacyMessageEntry[];
	/** age recipients for the re-encryption: the same two the send path uses. */
	targets: string[];
}): Promise<number> {
	if (input.targets.length === 0) return 0;

	const converted: { id: string; ciphertext: string }[] = [];
	for (const entry of input.entries) {
		const payload = entry.payload;
		// `undefined` is still decrypting; `null` is a body encrypted to a key
		// this device no longer has. Neither can be converted, and the null case
		// never will be — see the residue note in docs/temporary-code.md.
		if (!payload) continue;
		// Belt and braces: never rewrite something already converted.
		if (looksLikeRichTextDocument(payload.text)) continue;

		const next: MessagePayload = {
			...payload,
			text: JSON.stringify(legacyTextToDocument(payload.text))
		};
		converted.push({ id: entry.id, ciphertext: await encryptPayload(next, input.targets) });
	}

	if (converted.length === 0) return 0;

	try {
		const response = await fetch(`/api/partnerships/${input.partnershipId}/legacy-bodies`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ messages: converted })
		});
		if (!response.ok) return 0;
	} catch {
		return 0;
	}
	return converted.length;
}

/**
 * Convert a description the viewer is allowed to edit, or null when there is
 * nothing to do.
 *
 * Unlike a message this needs no key, so it is a pure string-to-string
 * conversion; the caller posts it to the endpoint that re-checks permission.
 */
export function convertLegacyDescription(description: string | null): string | null {
	if (description === null || description.trim() === '') return null;
	if (looksLikeRichTextDocument(description)) return null;
	return JSON.stringify(legacyTextToDocument(description));
}

export type LegacyDescriptionItem = { id: string; description: string | null };

/**
 * Convert the legacy descriptions in a list and write back the ones the viewer
 * may edit.
 *
 * Call it only with items the viewer can actually edit — the server re-checks
 * anyway, so this is about not making pointless requests rather than about
 * safety. Silent on failure, like the message path: nobody asked for this.
 */
export async function migrateLegacyDescriptions(input: {
	kind: 'self-task' | 'self-reward' | 'partnership-task' | 'partnership-reward';
	partnershipId?: string | null;
	items: LegacyDescriptionItem[];
}): Promise<number> {
	const updates = [];
	for (const item of input.items) {
		const converted = convertLegacyDescription(item.description);
		if (converted === null) continue;
		updates.push({
			kind: input.kind,
			id: item.id,
			...(input.partnershipId ? { partnershipId: input.partnershipId } : {}),
			description: converted
		});
	}
	if (updates.length === 0) return 0;

	try {
		const response = await fetch('/api/legacy-descriptions', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ updates })
		});
		if (!response.ok) return 0;
	} catch {
		return 0;
	}
	return updates.length;
}
