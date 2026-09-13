<script lang="ts">
	import ThreadSticker from './ThreadSticker.svelte';
	import type { ThreadStickerView } from '$lib/types';

	/**
	 * The board: unread threads first, then a divider, then the read ones.
	 *
	 * Two separate lists rather than one grid with a full-width row in the
	 * middle. Both declare the same columns, so at a given width `auto-fill`
	 * resolves to the same count and the two blocks stay aligned — and "unread
	 * first" becomes plain document order, which is what a screen reader and a
	 * test locator both want.
	 *
	 * The threads arrive already sorted; the server owns that order (see
	 * `listBoard`). This component only decides where the seam goes.
	 */
	let {
		threads,
		partnershipId
	}: {
		threads: ThreadStickerView[];
		partnershipId: string;
	} = $props();

	const unread = $derived(threads.filter((thread) => thread.unread));
	const read = $derived(threads.filter((thread) => !thread.unread));
</script>

{#if threads.length === 0}
	<p class="empty">Nothing here yet. Write something only the two of you can read.</p>
{:else}
	{#if unread.length > 0}
		<ul aria-label="Unread">
			{#each unread as thread, index (thread.id)}
				<ThreadSticker {thread} {partnershipId} position={index + 1} total={unread.length} />
			{/each}
		</ul>
	{/if}

	{#if unread.length > 0 && read.length > 0}
		<div class="seam">
			<wa-divider></wa-divider>
			<span>Already read</span>
			<wa-divider></wa-divider>
		</div>
	{/if}

	{#if read.length > 0}
		<ul aria-label="Already read">
			{#each read as thread, index (thread.id)}
				<ThreadSticker {thread} {partnershipId} position={index + 1} total={read.length} />
			{/each}
		</ul>
	{/if}
{/if}

<style>
	ul {
		list-style: none;
		margin: 0;
		padding: var(--wa-space-m);
		display: grid;
		/*
		 * auto-fill, not auto-fit: on a 320px phone this settles at three columns
		 * and keeps a real tap target, where auto-fit would stretch two stickers
		 * across the width.
		 */
		grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
		gap: var(--wa-space-s);
	}

	.seam {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		gap: var(--wa-space-s);
		padding-inline: var(--wa-space-m);

		span {
			font-size: 0.75rem;
			color: var(--wa-color-text-quiet);
		}
	}

	.empty {
		margin: 0;
		padding: var(--wa-space-xl) var(--wa-space-l);
		text-align: center;
		color: var(--wa-color-text-quiet);
	}
</style>
