<script lang="ts">
	import { tick } from 'svelte';
	import { invalidate } from '$app/navigation';
	import { scrollIntoViewWithin } from '$lib/scroll-parent';
	import { currentKeyring } from '$lib/crypto/session.svelte';
	import { buildReaction, openMessage, openReaction, sendMessage } from '$lib/messaging/client';
	import type { MessagePayload } from '$lib/crypto/messages';
	import type { MessageView, PartnerRecipientsView, TagView, ThreadView } from '$lib/types';
	import MessageBubble from './MessageBubble.svelte';
	import MessageComposer from './MessageComposer.svelte';
	import TagPicker from './TagPicker.svelte';

	let {
		thread,
		partnershipId,
		tags = [],
		recipients,
		/**
		 * False while this device distrusts one of the two keys.
		 *
		 * The reply box is removed rather than disabled: the reason is a callout
		 * on the board, and an inert textarea with no explanation next to it
		 * reads as a bug. Passed in rather than derived here so the board and
		 * the thread cannot disagree about it.
		 */
		canSend = true
	}: {
		thread: ThreadView;
		partnershipId: string;
		tags?: TagView[];
		recipients: PartnerRecipientsView;
		canSend?: boolean;
	} = $props();

	const keyring = $derived(currentKeyring());
	// Selection is the live control state; re-deriving it on every thread refresh
	// would undo a tag click while the assignment request is in flight.
	// svelte-ignore state_referenced_locally
	let selectedTagIds = $state(thread.tags?.map((tag) => tag.id) ?? []);

	/**
	 * Decrypted bodies, by message id.
	 *
	 * `undefined` means "still working", `null` means "this identity cannot open
	 * it" — a real state, not an error, for a message sent to a key the user
	 * replaced. `MessageBubble` renders the three cases differently.
	 */
	let bodies: Record<string, MessagePayload | null> = $state({});
	let reactions: Record<string, { emoji: string; mine: boolean }[]> = $state({});
	let listElement: HTMLElement | undefined = $state();

	$effect(() => {
		const unlocked = keyring.status === 'unlocked' ? keyring.identity : null;
		if (!unlocked) return;

		// Captured so a run superseded by a newer one bails out rather than
		// writing stale plaintext over fresh — the same guard EdgeTask.svelte uses.
		const messages = thread.messages;
		let cancelled = false;

		void (async () => {
			for (const message of messages) {
				if (cancelled) return;
				if (!(message.id in bodies)) {
					bodies[message.id] = await openMessage(message.ciphertext, unlocked);
				}
				const decoded: { emoji: string; mine: boolean }[] = [];
				for (const reaction of message.reactions) {
					const emoji = await openReaction(reaction.ciphertext, unlocked);
					if (emoji) decoded.push({ emoji, mine: reaction.mine });
				}
				if (cancelled) return;
				reactions[message.id] = decoded;
			}
		})();

		return () => {
			cancelled = true;
		};
	});

	// Keeps the newest message in view. Goes through the shared scroll helper
	// because `<main>` is the only scrolling element in this shell — the window
	// does not scroll, so window.scrollTo would move nothing.
	$effect(() => {
		const count = thread.messages.length;
		void tick().then(() => {
			if (!listElement || count !== thread.messages.length) return;
			const last = listElement.lastElementChild;
			if (last) scrollIntoViewWithin(last, listElement, { behavior: 'auto', gap: 8 });
		});
	});

	const targets = $derived(
		[recipients.mine, recipients.theirs].filter((value): value is string => value !== null)
	);

	function formatWhen(date: Date): string {
		return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
	}

	async function send(message: { text: string; files: File[] }): Promise<string | null> {
		const outcome = await sendMessage(
			{ kind: 'reply', partnershipId, threadId: thread.id },
			message,
			targets
		);
		if (!outcome.ok) return outcome.message;
		await invalidate(`messages:thread:${thread.id}`);
		return null;
	}

	async function react(message: MessageView, emoji: string) {
		const ciphertext = await buildReaction(emoji, targets);
		const response = await fetch(
			`/api/partnerships/${partnershipId}/messages/${message.id}/reaction`,
			{
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ ciphertext })
			}
		);
		if (response.ok) await invalidate(`messages:thread:${thread.id}`);
	}

	async function clearReaction(message: MessageView) {
		const response = await fetch(
			`/api/partnerships/${partnershipId}/messages/${message.id}/reaction`,
			{ method: 'DELETE' }
		);
		if (response.ok) await invalidate(`messages:thread:${thread.id}`);
	}
</script>

<div class="thread">
	<div class="thread-tags">
		<TagPicker {partnershipId} {tags} threadId={thread.id} bind:selectedIds={selectedTagIds} />
	</div>
	<ul bind:this={listElement} class="messages">
		{#each thread.messages as message (message.id)}
			<MessageBubble
				{message}
				payload={message.id in bodies ? bodies[message.id] : undefined}
				{partnershipId}
				when={formatWhen(message.createdAt)}
				reactions={reactions[message.id] ?? []}
				onReact={(emoji) => react(message, emoji)}
				onClearReaction={() => clearReaction(message)}
			/>
		{/each}
	</ul>

	<!--
		`position: sticky; bottom: 0` INSIDE the scrolling <main> pins this to the
		bottom of the scrollport, directly above AppNav. Sticky against the
		viewport does not work in this shell and teleporting to <body> does not
		either, because <body> does not scroll — EdgeTask.svelte's footer is the
		working precedent, gradient fade included.
	-->
	{#if canSend}
		<footer>
			<MessageComposer {send} placeholder="Reply…" />
		</footer>
	{/if}
</div>

<style>
	.thread {
		display: flex;
		flex-direction: column;
		/* flex, not min-height: 100% — the shell only sets min-height on the page
		   wrapper, so a percentage height has no specified ancestor to resolve
		   against. */
		flex: 1 1 auto;
		min-block-size: 0;
	}

	.messages {
		list-style: none;
		margin: 0;
		padding: var(--wa-space-m);
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		flex: 1 1 auto;
	}

	.thread-tags {
		padding: var(--wa-space-s) var(--wa-space-m) 0;
	}

	footer {
		position: sticky;
		inset-block-end: 0;
		padding: var(--wa-space-s) var(--wa-space-m) var(--wa-space-m);
		/* So bubbles scrolling under the composer stay legible on the way past. */
		background: linear-gradient(
			to bottom,
			transparent,
			var(--wa-color-surface-default, white) 0.75rem
		);
	}
</style>
