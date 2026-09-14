<script lang="ts">
	import {
		describeTimeZoneDifference,
		formatDateTimeInTimeZoneForViewer,
		humanizeTimeZone,
		UTC_TIMEZONE
	} from '$lib/timezone';

	interface Props {
		timeZone: string | null;
		referenceTimeZone?: string;
		date?: Date;
		showCurrentTime?: boolean;
		className?: string;
	}

	let {
		timeZone,
		referenceTimeZone = UTC_TIMEZONE,
		date = new Date(),
		showCurrentTime = false,
		className = ''
	}: Props = $props();

	const visible = $derived(Boolean(timeZone && timeZone !== referenceTimeZone));
	const currentTime = $derived(
		showCurrentTime && timeZone
			? `${formatDateTimeInTimeZoneForViewer(timeZone, referenceTimeZone, date)} `
			: ''
	);
	const summary = $derived(timeZone ? `${humanizeTimeZone(timeZone)} time` : '');
	const detail = $derived(
		timeZone ? describeTimeZoneDifference(timeZone, referenceTimeZone, date) : ''
	);
</script>

{#if visible}
	<p class={`timezone ${className}`.trim()}>
		<wa-icon name="globe" variant="solid"></wa-icon>
		<span>{currentTime}{summary} ({detail})</span>
	</p>
{/if}

<style>
	.timezone {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
		color: var(--wa-color-text-quiet);
		font-size: 0.9375rem;
		flex-wrap: wrap;
		margin: 0;
	}

	.timezone :global(wa-icon) {
		flex: 0 0 auto;
	}
</style>
