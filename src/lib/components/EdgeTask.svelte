<script lang="ts">
	import RichText from '$lib/components/RichText.svelte';
	import { scrollIntoViewWithin } from '$lib/scroll-parent';
	import type { EdgeTaskView } from '$lib/types';
	import type { WaSelectEvent } from '@awesome.me/webawesome/dist/events/select.js';
	import { tick } from 'svelte';

	let { edgeTask }: { edgeTask: EdgeTaskView } = $props();
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
	const remaining = $derived(Math.max(edgeTask.instructions.required - count, 0));
	// NOTE: there was a `const action = { edge: 'edged' }[edgeTask.action] || 'edged'`
	// here. `edgeTask.action` does not exist — the field is
	// `edgeTask.instructions.action` — so the `|| 'edged'` fallback silently hid the
	// bug. It was also never referenced in the template (the footer hardcodes
	// the word), so it is removed rather than corrected.

	let mainElm: HTMLElement | undefined = $state();

	$effect.pre(() => {
		// `count` is read here so the effect re-runs whenever it changes, and
		// captured so a run superseded by a newer one bails out instead of
		// scrolling to a paragraph that is no longer the last.
		const countAtRun = count;
		void tick().then(() => {
			if (countAtRun !== count) return;
			const lastInstruction = mainElm?.querySelector(' & > p:last-child');
			if (!lastInstruction || !mainElm) return;
			// Shared with ThreadView, which needs exactly this. The comment about
			// why the window cannot be scrolled here now lives in scroll-parent.ts.
			scrollIntoViewWithin(lastInstruction, mainElm);
		});
	});
</script>

<div>
	<main bind:this={mainElm}>
		{#each edgeTask.instructions.displayText.filter((displayText) => count >= displayText.showFrom) as displayText (displayText.showFrom)}
			<!-- One wrapper per passage: RichText emits its own <p>s, and a child
			     component's elements are outside this component's scoped CSS, so the
			     first/last-child divider rules below need an element of their own. -->
			<div class="passage"><RichText text={displayText.text} /></div>
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
			<!-- svelte-ignore a11y_click_events_have_key_events,a11y_no_static_element_interactions -->
			<wa-button onclick={increment}>Record Edge</wa-button>
			<wa-button-group label="Deduct edges">
				<!-- svelte-ignore a11y_click_events_have_key_events,a11y_no_static_element_interactions -->
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

			.passage:first-child {
				margin: 0 0 var(--wa-space-xl) 0;
			}

			.passage:last-child:not(:first-child) {
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
