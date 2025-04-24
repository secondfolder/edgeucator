<script lang="ts">
	import { teleport } from '$lib/teleport';
	import { tick } from 'svelte';

	let { task } = $props();
	let count: number = $state(0);
	const increment = () => {
		count += 1;
	};
	const decrement = (amountToDecrementBy: number = 1) => {
		count -= amountToDecrementBy;
	};
	const remaining = $derived(Math.max(task.instructions.required - count, 0));
	const action =
		{
			edge: 'edged'
		}[task.action] || 'edged';

	let mainElm;

	$effect.pre(() => {
		count; // Included to $effect will trigger on count change
		tick().then(() => {
			const lastInstruction = mainElm.querySelector(' & > p:last-child');
			if (!lastInstruction) return;
			const scrollPos = lastInstruction.getBoundingClientRect().top + window.scrollY - 20;
			window.scrollTo({ top: scrollPos, behavior: 'smooth' });
			console.log('hiii', lastInstruction);
		});
	});
</script>

<div>
	<main bind:this={mainElm}>
		{#each task.instructions.displayText.filter((displayText) => count >= displayText.showFrom) as displayText}
			<p>
				{displayText.text}
			</p>
		{/each}
	</main>
	<footer use:teleport={'body'}>
		<div class="info">
			{count} edge{count !== 1 ? 's' : ''}, {remaining} to go
		</div>
		<div class="controls">
			<wa-button onclick={increment}>Record Edge</wa-button>
			<wa-button-group label="Example Button Group" variant="neutral" appearance="outlined">
				<wa-button appearance="outlined" onclick={() => decrement()}>Deduct Edge</wa-button>
				<wa-dropdown placement="bottom-end" hoist>
					<wa-button slot="trigger" caret appearance="outlined">
						<span class="wa-visually-hidden">More options</span>
					</wa-button>
					<wa-menu>
						<wa-menu-item onclick={() => decrement(100)}>-100</wa-menu-item>
						<wa-menu-item onclick={() => decrement(50)}>-50</wa-menu-item>
						<wa-menu-item onclick={() => decrement(20)}>-20</wa-menu-item>
						<wa-menu-item onclick={() => decrement(10)}>-10</wa-menu-item>
						<wa-menu-item onclick={() => decrement(5)}>-5</wa-menu-item>
					</wa-menu>
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
