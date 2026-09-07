<script lang="ts">
	import { resolve } from '$app/paths';
	import { stickerStyle } from '$lib/sticker';
	import type { ThreadStickerView } from '$lib/types';

	/**
	 * One thread, as a sticker on the board.
	 *
	 * The tilt and offset come from `stickerStyle`, which derives them from the
	 * thread id — so the board looks identical on every reload, on both people's
	 * phones, and after a new thread pushes the others down. An index-derived
	 * layout would reshuffle every sticker whenever anyone sent anything.
	 */
	let {
		thread,
		partnershipId,
		/** 1-based, for the accessible name. Two stickers can share a timestamp. */
		position,
		total,
		when
	}: {
		thread: ThreadStickerView;
		partnershipId: string;
		position: number;
		total: number;
		when: string;
	} = $props();

	const href = $derived(
		resolve('/(auth-required)/(app)/partner/[id]/messages/[threadId]', {
			id: partnershipId,
			threadId: thread.id
		})
	);

	// Two links must not share an accessible name (AGENTS.md), and on a board of
	// identical envelopes the only distinguishing facts are the position and the
	// time — so both go in.
	const label = $derived(
		`${thread.unread ? 'Unread message' : 'Message'} ${position} of ${total}, ${when}` +
			(thread.messageCount > 1 ? `, ${thread.messageCount} messages` : '')
	);
</script>

<li>
	<a {href} class:unread={thread.unread} style={stickerStyle(thread.id)} aria-label={label}>
		<wa-icon name={thread.icon} variant="solid" canvas="square"></wa-icon>
		{#if thread.unread}
			<!-- Not colour alone: an unread marker that is only a hue fails for
			     anyone who cannot see it. The accessible name says so too. -->
			<span class="dot" aria-hidden="true"></span>
		{/if}
	</a>
</li>

<style>
	li {
		position: relative;
	}

	a {
		position: relative;
		display: grid;
		place-items: center;
		aspect-ratio: 1;
		text-decoration: none;
		color: var(--wa-color-text-quiet);
		/* Kills the grey flash on tap that makes a web app feel non-native. */
		-webkit-tap-highlight-color: transparent;

		/*
		 * The sticker look. Percentages resolve against the element's own box, so
		 * the offset scales with the cell rather than drifting out of it at large
		 * viewports — and because it is capped at ±12%, two neighbours can never
		 * overlap enough to hide either. Document order carries the board's
		 * ordering, which this transform leaves alone entirely.
		 */
		transform: translate(var(--jx), var(--jy)) rotate(var(--tilt));
		transition: transform var(--wa-transition-fast, 100ms) ease;

		wa-icon {
			font-size: clamp(2rem, 9vw, 2.75rem);
		}

		&:hover,
		&:focus-visible {
			/* Straightens as you reach for it, which reads as picking it up. */
			transform: translate(var(--jx), var(--jy)) rotate(0deg) scale(1.06);
		}

		&.unread {
			color: var(--wa-color-brand-fill-loud, var(--wa-color-text-link));

			wa-icon {
				filter: drop-shadow(0 0 0.35rem var(--wa-color-brand-fill-quiet, transparent));
			}
		}

		.dot {
			position: absolute;
			inset-block-start: 0;
			inset-inline-end: 0;
			inline-size: 0.6rem;
			block-size: 0.6rem;
			border-radius: 50%;
			background: var(--wa-color-brand-fill-loud, currentColor);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		/* The tilt is a static transform rather than motion, and it is the whole
		   point of the board, so it stays. What goes is the settle on hover. */
		a {
			transition: none;
		}

		a:hover,
		a:focus-visible {
			transform: translate(var(--jx), var(--jy));
		}
	}
</style>
