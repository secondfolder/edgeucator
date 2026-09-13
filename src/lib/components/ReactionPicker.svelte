<script lang="ts">
	/** The six tapbacks. A closed set, like the thread icons. */
	const REACTIONS = ['❤️', '🔥', '😍', '😮', '😂', '👍'] as const;

	let {
		messageId,
		current,
		react,
		clear
	}: {
		messageId: string;
		/** The viewer's own reaction, if they have one. */
		current: string | null;
		react: (emoji: string) => Promise<void>;
		clear: () => Promise<void>;
	} = $props();

	let open = $state(false);
	let busy = $state(false);

	async function choose(emoji: string) {
		busy = true;
		try {
			// Tapping the one you already chose removes it, which is what every
			// other tapback UI does and what people will try.
			if (emoji === current) await clear();
			else await react(emoji);
			open = false;
		} finally {
			busy = false;
		}
	}

	const triggerId = $derived(`react-${messageId}`);
</script>

<button
	id={triggerId}
	type="button"
	class="trigger"
	aria-label={current ? `Change your reaction (${current})` : 'Add a reaction'}
	aria-expanded={open}
	onclick={() => (open = !open)}
>
	<!-- Always the same smiley, never the chosen emoji: the reaction itself is
	     already shown under the message, so echoing it here duplicated it. -->
	☺
</button>

{#if open}
	<div class="menu" role="group" aria-label="Reactions">
		{#each REACTIONS as emoji (emoji)}
			<button
				type="button"
				class:chosen={emoji === current}
				disabled={busy}
				aria-label={emoji}
				onclick={() => choose(emoji)}
			>
				{emoji}
			</button>
		{/each}
	</div>
{/if}

<style>
	.trigger {
		border: none;
		background: none;
		cursor: pointer;
		padding: 0 0.125rem;
		font-size: 0.875rem;
		line-height: 1;
		color: inherit;
		opacity: 0.7;

		&:hover,
		&:focus-visible {
			opacity: 1;
		}
	}

	.menu {
		display: flex;
		gap: 0.125rem;
		padding: 0.25rem;
		border-radius: 1rem;
		background: var(--wa-color-surface-raised, white);
		border: 1px solid var(--wa-color-surface-border);
		box-shadow: 0 2px 8px rgb(0 0 0 / 15%);

		button {
			border: none;
			background: none;
			cursor: pointer;
			font-size: 2rem;
			line-height: 1;
			padding: 0.125rem 0.25rem;
			border-radius: 0.75rem;
			height: 1.2em;

			&.chosen {
				background: var(--wa-color-brand-fill-quiet, rgb(0 0 0 / 8%));
			}
		}
	}
</style>
