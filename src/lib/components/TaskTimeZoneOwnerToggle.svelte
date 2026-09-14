<script lang="ts">
	import { describeTimeZoneDifference } from '$lib/timezone';

	interface Props {
		viewerUserId: string;
		viewerTimezone: string;
		counterpartUserId: string;
		counterpartTimezone: string;
		counterpartName: string;
		onSelect?: () => void;
		value: string;
	}

	let {
		viewerUserId,
		viewerTimezone,
		counterpartUserId,
		counterpartTimezone,
		counterpartName,
		onSelect = () => {},
		value = $bindable()
	}: Props = $props();

	const visible = $derived(viewerTimezone !== counterpartTimezone);
	const counterpartOffset = $derived(
		describeTimeZoneDifference(counterpartTimezone, viewerTimezone)
	);
</script>

{#if visible}
	<div class="toggle" role="group" aria-label="Timezone owner">
		<button
			type="button"
			class:selected={value === viewerUserId}
			onclick={() => {
				value = viewerUserId;
				onSelect();
			}}
		>
			Your time
		</button>
		<button
			type="button"
			class:selected={value === counterpartUserId}
			onclick={() => {
				value = counterpartUserId;
				onSelect();
			}}
		>
			{counterpartName}'s time ({counterpartOffset})
		</button>
	</div>
{/if}

<style>
	.toggle {
		display: inline-flex;
		gap: 0.35rem;
		flex-wrap: wrap;
	}

	button {
		font: inherit;
		padding: 0.35rem 0.65rem;
		border: 1px solid var(--wa-color-surface-border);
		border-radius: 999px;
		background: var(--wa-color-surface-default);
		color: var(--wa-color-text-normal);
		cursor: pointer;
	}

	button.selected {
		background: color-mix(in srgb, var(--wa-color-brand-fill-quiet) 70%, white);
		border-color: var(--wa-color-brand-border-loud);
	}
</style>
