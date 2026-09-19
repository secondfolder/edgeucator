<script lang="ts">
	import AttachmentPreview from './AttachmentPreview.svelte';
	import ReactionPicker from './ReactionPicker.svelte';
	import RichText from './RichText.svelte';
	import type { MessageMetadataPayload, MessagePayload } from '$lib/crypto/messages';
	import type { MessageView } from '$lib/types';

	/**
	 * One message.
	 *
	 * `payload` is null until decryption resolves, and may stay null — a thread
	 * can hold messages encrypted to a key the user no longer has, if their
	 * password was reset. That state gets its own text rather than looking like
	 * a blank message.
	 *
	 * The body is NEVER rendered from `message.ciphertext`. There is a component
	 * test asserting the ciphertext string does not appear in the output, which
	 * is the worst bug this component could have.
	 */
	let {
		message,
		payload,
		metadata,
		autoLoadEmbeds = false,
		onRevealEmbed,
		onRefreshEmbed,
		partnershipId,
		when,
		reactions,
		onReact,
		onClearReaction
	}: {
		message: MessageView;
		payload: MessagePayload | null | undefined;
		metadata: MessageMetadataPayload | null | undefined;
		autoLoadEmbeds?: boolean;
		onRevealEmbed: (href: string) => void | Promise<void>;
		onRefreshEmbed: (href: string) => void | Promise<void>;
		partnershipId: string;
		when: string;
		/** Already-decrypted reaction emoji, with whose they are. */
		reactions: { emoji: string; mine: boolean }[];
		onReact: (emoji: string) => Promise<void>;
		onClearReaction: () => Promise<void>;
	} = $props();

	const mine = $derived(message.mine);
	const myReaction = $derived(reactions.find((reaction) => reaction.mine)?.emoji ?? null);
	const cachedEmbeds = $derived(metadata?.embeds ?? []);
	const cachedEmbedsPending = $derived(
		message.metadataCiphertext !== null && metadata === undefined
	);
</script>

<li class:mine class:theirs={!mine}>
	<div class="bubble">
		{#if payload === undefined}
			<span class="pending" aria-label="Decrypting">···</span>
		{:else if payload === null}
			<span class="unreadable">
				You can't read this one — it was sent to a key you no longer have. Ask your partner to
				restore your history.
			</span>
		{:else}
			{#if payload.text}
				<div class="text">
					<RichText
						text={payload.text}
						{cachedEmbeds}
						{cachedEmbedsPending}
						{autoLoadEmbeds}
						requireExplicitReveal
						{onRevealEmbed}
						{onRefreshEmbed}
					/>
				</div>
			{/if}
			{#each payload.attachments as info (info.id)}
				<AttachmentPreview {info} {partnershipId} />
			{/each}
		{/if}

		{#if reactions.length > 0}
			<ul class="reactions" aria-label="Reactions">
				{#each reactions as reaction, index (index)}
					<li>{reaction.emoji}</li>
				{/each}
			</ul>
		{/if}
	</div>

	<div class="meta">
		<span class="when">{when}</span>
		<!-- Only on messages you received: the requirement is reacting to what
		     your partner sent, and setReaction refuses your own regardless. -->
		{#if !mine}
			<ReactionPicker
				messageId={message.id}
				current={myReaction}
				react={onReact}
				clear={onClearReaction}
			/>
		{/if}
	</div>
</li>

<style>
	li {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		max-inline-size: min(78%, 34rem);

		&.mine {
			margin-inline-start: auto;
			align-items: flex-end;

			.bubble {
				background: var(--wa-color-brand-fill-loud, #2563eb);
				color: var(--wa-color-brand-on-loud, white);
				border-end-end-radius: 0.25rem;

				:global(.text a),
				:global(.card-link),
				:global(.card-shell) {
					color: inherit;
				}

				:global(.card-shell) {
					border-color: rgb(255 255 255 / 22%);
					background: rgb(255 255 255 / 8%);
				}

				:global(.card-media) {
					border-block-start-color: rgb(255 255 255 / 22%);
				}

				.reactions {
					inset-inline-start: unset;
					inset-inline-end: 0.5rem;
				}
			}
		}

		&.theirs {
			margin-inline-end: auto;
			align-items: flex-start;

			.bubble {
				background: var(--wa-color-neutral-fill-quiet, rgb(0 0 0 / 6%));
				border-end-start-radius: 0.25rem;
			}
		}
		.bubble {
			position: relative;
			padding: 0.5rem 0.75rem;
			border-radius: 1rem;
			display: flex;
			flex-direction: column;
			gap: 0.375rem;

			&:has(.reactions) {
				margin-block-end: 0.5rem;
			}

			&:not(:has(.text)) {
				padding: 0;
			}

			.text {
				margin: 0;
				/* A <div>, not a <p>: RichText emits its own block elements, and a
				   list or a paragraph nested inside a <p> is invalid markup the
				   browser silently unnests.

				   No `white-space: pre-wrap` either. The sender's line breaks are
				   real <br> elements in the document now, so preserving whitespace
				   here would render every one of them twice. */
				overflow-wrap: anywhere;
			}

			.pending {
				letter-spacing: 0.15em;
				opacity: 0.6;
			}

			.unreadable {
				font-size: 0.8125rem;
				font-style: italic;
				opacity: 0.85;
			}
		}

		.reactions {
			list-style: none;
			margin: 0;
			padding: 0;
			display: flex;
			gap: 0.125rem;
			/* Half-overlapping the bubble's bottom edge, the way a tapback sits.
               Absolute inside a relative bubble — not against the viewport, which
               would not work in this shell. */
			position: absolute;
			inset-block-end: -0.75rem;
			inset-inline-start: 0.5rem;
			background: var(--wa-color-surface-default, white);
			border-radius: 1rem;
			padding: 0.0625rem 0.25rem;
			box-shadow: 0 1px 3px rgb(0 0 0 / 15%);
			font-size: 0.8125rem;

			li {
				margin: 0;
			}
		}

		.meta {
			display: flex;
			align-items: center;
			gap: 0.375rem;
			font-size: 0.6875rem;
			color: var(--wa-color-text-quiet);
			min-block-size: 1.25rem;
		}
	}
</style>
