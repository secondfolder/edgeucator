/**
 * Re-encrypting a shared history to a partner's new key.
 *
 * BROWSER ONLY — this decrypts, so it needs the unlocked identity.
 *
 * Runs on the device of the partner who did **not** lose their key. They can
 * read every message in the partnership (they are one of the two recipients on
 * all of them), so they can open each body and seal a fresh copy to
 * `{ themselves, the requester's new recipient }`. The server stores the new
 * ciphertext and still cannot read any of it.
 *
 * Three things about this are deliberate and worth not undoing:
 *
 * - **Attachments are never touched.** Each file is encrypted under its own
 *   ephemeral age identity, and that identity travels *inside* the message
 *   body. Re-encrypting a few kilobytes per message therefore restores access
 *   to every 25 MB video in the object store for free. Encrypting files
 *   directly to the two partners would have made recovery mean re-uploading
 *   everything.
 * - **The requester's recipient comes from the request row, not from
 *   `user_keys`.** It is the value snapshotted when the request was raised and
 *   confirmed against the safety number the partner read out loud. Using
 *   whatever the server currently claims is that user's key would hand the
 *   whole history to a server that had just swapped it, and the out-of-band
 *   comparison would have been for nothing.
 * - **A body that will not open is skipped, not failed on.** A partnership can
 *   legitimately contain messages predating the *actor's* own key — if both
 *   partners have reset at different times, some rows are readable by neither.
 *   Stopping there would mean no restore ever completes for those two.
 */

import {
	decryptMessageMetadata,
	decryptPayload,
	encryptMessageMetadata,
	encryptPayload
} from '../crypto/messages';
import type { MessageMetadataPayload, MessagePayload, ReactionPayload } from '../crypto/messages';
import { unlockedIdentity } from '../crypto/session.svelte';

type RestorePage = {
	messages: { id: string; ciphertext: string; metadataCiphertext?: string | null }[];
	reactions: { id: string; ciphertext: string }[];
	nextCursor: string | null;
};

export type RestoreProgress = {
	/** Rows re-encrypted so far. */
	done: number;
	/** Rows that could not be opened on this device, and were left alone. */
	skipped: number;
};

export type RestoreOutcome = ({ ok: true } & RestoreProgress) | { ok: false; message: string };

/**
 * Pages through the whole history, re-encrypting as it goes.
 *
 * Each page is written back before the next is fetched, so a connection that
 * drops halfway leaves the earlier pages already restored. The request stays
 * open in that case, and running it again re-does the lot — which is harmless,
 * because re-encrypting an already-re-encrypted body produces another body both
 * parties can read.
 */
export async function runHistoryRestore(
	partnershipId: string,
	request: { id: string; requestedRecipient: string },
	onProgress?: (progress: RestoreProgress) => void
): Promise<RestoreOutcome> {
	const unlocked = unlockedIdentity();
	if (!unlocked) {
		return { ok: false, message: 'Unlock your messages first, then try again.' };
	}

	// Both sides, always: sealing only to the requester would restore their
	// access and destroy the actor's own.
	const recipients = [unlocked.recipient, request.requestedRecipient];

	const progress: RestoreProgress = { done: 0, skipped: 0 };
	let cursor: string | null = null;

	try {
		for (;;) {
			const page = await fetchPage(partnershipId, request.id, cursor);

			const messages: { id: string; ciphertext: string; metadataCiphertext?: string | null }[] = [];
			for (const row of page.messages) {
				const payload = await decryptPayload<MessagePayload>(row.ciphertext, unlocked.identity);
				if (!payload) {
					progress.skipped += 1;
					continue;
				}
				const next: { id: string; ciphertext: string; metadataCiphertext?: string | null } = {
					id: row.id,
					ciphertext: await encryptPayload(payload, recipients)
				};
				if (row.metadataCiphertext !== undefined) {
					const metadata =
						row.metadataCiphertext === null
							? null
							: await decryptMessageMetadata(row.metadataCiphertext, unlocked.identity);
					next.metadataCiphertext = metadata
						? await encryptMessageMetadata(metadata as MessageMetadataPayload, recipients)
						: null;
				}
				messages.push(next);
			}

			const reactions: { id: string; ciphertext: string }[] = [];
			for (const row of page.reactions) {
				const payload = await decryptPayload<ReactionPayload>(row.ciphertext, unlocked.identity);
				if (!payload) {
					progress.skipped += 1;
					continue;
				}
				reactions.push({ id: row.id, ciphertext: await encryptPayload(payload, recipients) });
			}

			const final = page.nextCursor === null;
			// Posted even when both arrays are empty, because `final` is what closes
			// the request — a history whose every row was skipped still has to stop
			// prompting the requester.
			await applyPage(partnershipId, request.id, { messages, reactions, final });

			progress.done += messages.length + reactions.length;
			onProgress?.({ ...progress });

			if (final) return { ok: true, ...progress };
			cursor = page.nextCursor;
		}
	} catch (error) {
		console.error(error);
		return {
			ok: false,
			message: 'Something went wrong part-way through. Anything already restored is saved.'
		};
	}
}

async function fetchPage(
	partnershipId: string,
	requestId: string,
	cursor: string | null
): Promise<RestorePage> {
	const url = new URL(`/api/partnerships/${partnershipId}/restore`, location.origin);
	url.searchParams.set('requestId', requestId);
	if (cursor) url.searchParams.set('cursor', cursor);

	const response = await fetch(url);
	if (!response.ok) throw new Error(`Could not read the history (${response.status})`);
	return response.json();
}

async function applyPage(
	partnershipId: string,
	requestId: string,
	body: { messages: unknown[]; reactions: unknown[]; final: boolean }
): Promise<void> {
	const response = await fetch(`/api/partnerships/${partnershipId}/restore`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ requestId, ...body })
	});
	if (!response.ok) throw new Error(`Could not save the restored history (${response.status})`);
}

/** Says no, so the requester is told rather than left waiting. */
export async function declineHistoryRestore(
	partnershipId: string,
	requestId: string
): Promise<boolean> {
	const response = await fetch(`/api/partnerships/${partnershipId}/restore`, {
		method: 'DELETE',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ requestId })
	});
	return response.ok;
}
