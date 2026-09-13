<script lang="ts">
	import { invalidate } from '$app/navigation';
	import { safetyNumber } from '$lib/crypto/fingerprint';
	import {
		declineHistoryRestore,
		runHistoryRestore,
		type RestoreProgress
	} from '$lib/messaging/restore';
	import type { RestoreRequestView } from '$lib/types';
	import SafetyNumber from './SafetyNumber.svelte';

	/**
	 * Open history-restore requests on a partner's board.
	 *
	 * Two very different cases share this component because they are the two
	 * ends of one thing:
	 *
	 * - **Mine** — I reset my password, so my old identity is gone and every
	 *   existing message is unreadable to me. I am waiting for my partner.
	 *   Nothing to do but be told that, and told what they will be asked.
	 * - **Theirs** — my partner lost their key and is asking me to re-encrypt
	 *   our shared history to their new one. This is the consequential one.
	 *
	 * The out-of-band comparison is **load-bearing, not a nicety**, and the copy
	 * has to carry that weight. Without it a dishonest server could inject a
	 * restore request carrying its own recipient and have the partner
	 * re-encrypt the entire history straight to it — one confirmation, complete
	 * compromise, no other step in the design that would catch it. So: the
	 * number is shown before the button, the button says what it means, and
	 * declining is offered as an equal option rather than buried.
	 */
	let {
		requests,
		partnershipId,
		partnerName,
		/** This user's own recipient, for computing the number. */
		mine
	}: {
		requests: RestoreRequestView[];
		partnershipId: string;
		partnerName: string;
		mine: string | null;
	} = $props();

	/**
	 * The number is derived from the recipient **snapshotted on the request**,
	 * never from whatever `user_keys` currently says.
	 *
	 * This is the point of the whole screen. `applyHistoryRestore` seals to the
	 * snapshot, so the number the user reads aloud has to describe the same
	 * value — computing it from the served key would let a server show a
	 * matching number and receive the history under a different one.
	 */
	const numbers = $derived.by(async () => {
		// A plain object rather than a Map, and deliberately not a SvelteMap: this
		// is a scratch lookup built fresh inside the derivation and never mutated
		// afterwards, so there is nothing for reactivity to observe. Same call as
		// the `masters` object in `session.svelte.ts`.
		const entries: Record<string, string> = {};
		if (!mine) return entries;
		for (const request of requests) {
			entries[request.id] = await safetyNumber(mine, request.requestedRecipient);
		}
		return entries;
	});

	type Busy = { id: string; progress: RestoreProgress | null };
	let busy: Busy | null = $state(null);
	let failure: string | null = $state(null);

	async function restore(request: RestoreRequestView) {
		failure = null;
		busy = { id: request.id, progress: null };
		try {
			const outcome = await runHistoryRestore(
				partnershipId,
				{ id: request.id, requestedRecipient: request.requestedRecipient },
				(progress) => {
					// Rebuilt rather than mutated: `busy` is the $state reference and
					// reassigning the object is what makes the label update.
					if (busy) busy = { id: request.id, progress };
				}
			);
			if (!outcome.ok) failure = outcome.message;
		} finally {
			busy = null;
			await invalidate(`messages:board:${partnershipId}`);
		}
	}

	async function decline(request: RestoreRequestView) {
		failure = null;
		busy = { id: request.id, progress: null };
		try {
			if (!(await declineHistoryRestore(partnershipId, request.id))) {
				failure = 'That request could not be declined — reload and try again.';
			}
		} finally {
			busy = null;
			await invalidate(`messages:board:${partnershipId}`);
		}
	}
</script>

{#each requests as request (request.id)}
	{#if request.mine}
		<wa-callout variant="warning" size="small">
			<wa-icon slot="icon" name="key" variant="solid"></wa-icon>
			<strong>Your old messages are locked</strong>
			<p>
				Your keys were replaced, so the messages here were encrypted to a key you no longer have.
				{partnerName} can restore them — they will be asked to compare a safety number with you first,
				so have that conversation somewhere other than this app.
			</p>
		</wa-callout>
	{:else}
		<wa-callout variant="warning">
			<wa-icon slot="icon" name="triangle-exclamation" variant="solid"></wa-icon>
			<strong>{partnerName} is asking for your shared history back</strong>
			<p>
				Their keys were replaced, so they can no longer read anything the two of you have sent. Your
				device can re-encrypt it all to their new key.
			</p>
			<!--
				Blunt on purpose. This is the one step that stands between a
				dishonest server and the entire conversation, so it says what
				confirming does and what a mismatch means.
			-->
			<p>
				<strong>Check with them first.</strong> If this number does not match the one
				{partnerName} reads back to you, someone else is asking — and confirming would hand them everything.
			</p>
			{#await numbers then resolved}
				{@const number = resolved[request.id]}
				{#if number}
					<SafetyNumber value={number} {partnerName} tone="warning" />
				{/if}
			{/await}

			<div class="actions">
				<!-- disabled={busy !== null}, never `|| undefined` — invariant 11. -->
				<!-- svelte-ignore a11y_click_events_have_key_events,a11y_no_static_element_interactions -->
				<wa-button
					size="s"
					variant="brand"
					disabled={busy !== null}
					onclick={() => restore(request)}
				>
					{busy?.id === request.id
						? busy.progress
							? `Restoring… ${busy.progress.done} done`
							: 'Restoring…'
						: `The number matches — restore it`}
				</wa-button>
				<!-- svelte-ignore a11y_click_events_have_key_events,a11y_no_static_element_interactions -->
				<wa-button
					size="s"
					appearance="outlined"
					disabled={busy !== null}
					onclick={() => decline(request)}
				>
					It doesn't match
				</wa-button>
			</div>
		</wa-callout>
	{/if}
{/each}

{#if failure}
	<wa-callout variant="danger" size="small">{failure}</wa-callout>
{/if}

<style>
	wa-callout {
		display: block;

		strong {
			display: block;
		}

		p {
			margin: 0.25rem 0 0.5rem;
			font-size: 0.875rem;

			strong {
				display: inline;
			}
		}

		.actions {
			display: flex;
			flex-wrap: wrap;
			gap: 0.5rem;
		}
	}
</style>
