<script lang="ts">
	import type { TaskView } from '$lib/types';
	import type { WaSelectEvent } from '@awesome.me/webawesome/dist/events/select.js';
	import { tick } from 'svelte';

	let { task }: { task: TaskView } = $props();
	let count: number = $state(0);
	const increment = () => {
		count += 1;
	};
	const decrement = (amountToDecrementBy: number = 1) => {
		count -= amountToDecrementBy;
	};
	// <wa-dropdown> reports selections via `wa-select` rather than a click on the
	// item, which is what also makes keyboard selection work — a click handler on
	// each item would only ever see pointer input.
	const handleDeductSelect = (event: WaSelectEvent) => {
		decrement(Number(event.detail.item.getAttribute('value')));
	};
	const remaining = $derived(Math.max(task.instructions.required - count, 0));
	// NOTE: there was a `const action = { edge: 'edged' }[task.action] || 'edged'`
	// here. `task.action` does not exist — the field is
	// `task.instructions.action` — so the `|| 'edged'` fallback silently hid the
	// bug. It was also never referenced in the template (the footer hardcodes
	// the word), so it is removed rather than corrected.

	let mainElm: HTMLElement | undefined = $state();

	/**
	 * The nearest ancestor that actually scrolls, falling back to the document.
	 *
	 * This used to be hard-coded to `window`, which was correct while guides
	 * lived under (public) and the page itself scrolled. Inside the app shell
	 * the only scrolling box is the layout's <main>, so scrolling the window
	 * moved nothing and the reveal stopped following the newest paragraph.
	 */
	function scrollParentOf(node: HTMLElement): HTMLElement {
		let candidate = node.parentElement;
		while (candidate) {
			const { overflowY } = getComputedStyle(candidate);
			if (overflowY === 'auto' || overflowY === 'scroll') return candidate;
			candidate = candidate.parentElement;
		}
		return document.scrollingElement as HTMLElement;
	}

	$effect.pre(() => {
		// `count` is read here so the effect re-runs whenever it changes, and
		// captured so a run superseded by a newer one bails out instead of
		// scrolling to a paragraph that is no longer the last.
		const countAtRun = count;
		tick().then(() => {
			if (countAtRun !== count) return;
			const lastInstruction = mainElm?.querySelector(' & > p:last-child');
			if (!lastInstruction || !mainElm) return;
			const scroller = scrollParentOf(mainElm);
			// The document's own rect already carries the scroll offset, so only a
			// real scrolling element needs its top subtracted.
			const scrollerTop =
				scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top;
			const scrollPos =
				lastInstruction.getBoundingClientRect().top - scrollerTop + scroller.scrollTop - 20;
			scroller.scrollTo({ top: scrollPos, behavior: 'smooth' });
		});
	});
</script>

<div>
	<main bind:this={mainElm}>
		{#each task.instructions.displayText.filter((displayText) => count >= displayText.showFrom) as displayText (displayText.showFrom)}
			<p>
				{displayText.text}
			</p>
		{/each}
	</main>
	<!-- This footer used to teleport into <body> so its sticky positioning could
	     escape the (public) layout's 800px column. In the app shell <body> does
	     not scroll, so a teleported footer just fell out of view; staying put
	     makes it stick to the bottom of the scrolling <main>, directly above the
	     nav bar, which is where it wanted to be all along. -->
	<footer>
		<div class="info">
			{count} edge{count !== 1 ? 's' : ''}, {remaining} to go
		</div>
		<div class="controls">
			<wa-button onclick={increment}>Record Edge</wa-button>
			<wa-button-group label="Deduct edges">
				<wa-button appearance="outlined" onclick={() => decrement()}>Deduct Edge</wa-button>
				<wa-dropdown placement="bottom-end" onwa-select={handleDeductSelect}>
					<wa-button slot="trigger" with-caret appearance="outlined">
						<span class="wa-visually-hidden">More options</span>
					</wa-button>
					<wa-dropdown-item value="100">-100</wa-dropdown-item>
					<wa-dropdown-item value="50">-50</wa-dropdown-item>
					<wa-dropdown-item value="20">-20</wa-dropdown-item>
					<wa-dropdown-item value="10">-10</wa-dropdown-item>
					<wa-dropdown-item value="5">-5</wa-dropdown-item>
				</wa-dropdown>
			</wa-button-group>
		</div>
	</footer>
</div>

<style>
	div {
		flex: 1 1 auto;
		display: flex;
		flex-direction: column;

		main {
			flex: 1 1 auto;

			:first-child {
				margin: 0 0 var(--wa-space-xl) 0;
			}

			:last-child:not(:first-child) {
				position: relative;

				&::before {
					display: block;
					content: '';
					width: 10em;
					height: 2px;
					background-color: rgb(255, 226, 62);
					position: absolute;
					left: 50%;
					top: -0.7em;
					transform: translateX(-50%);
				}
			}
		}
	}
	footer {
		width: 100%;
		display: flex;
		gap: 0.5em;
		padding: 1em;
		padding-bottom: 2em;
		flex-direction: column;
		align-items: center;
		position: sticky;
		bottom: 0em;
		--fade-height: 5em;
		background: linear-gradient(#0000 0%, var(--wa-color-surface-default) var(--fade-height));
		/* padding-top: calc(var(--fade-height) + 1em); */

		.info {
			text-align: center;
			background-color: var(--wa-color-surface-default);
			border-radius: 0.2em;
			padding: 0.5em 1em;
		}
		.controls {
			display: flex;
			flex-direction: row;
			flex-wrap: wrap;
			justify-content: center;
			gap: 0.5em;

			wa-button[appearance='outlined']::part(base) {
				background-color: var(--wa-color-surface-default);
			}

			wa-button::part(base) {
				/* Stop iOS Safari from zooming if button is tapped multiple times too quickly */
				touch-action: manipulation;
			}

			wa-button-group {
				--wa-button-group-gap: 0.5em;
			}
		}
	}
</style>
