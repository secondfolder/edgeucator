<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { initialsFor } from '$lib/initials';
	import { UTC_TIMEZONE } from '$lib/timezone';
	import TimeZoneDisplay from '$lib/components/TimeZoneDisplay.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let partner = $derived(data.partner);
	const viewerTimezone = $derived(page.data.user?.timezone ?? UTC_TIMEZONE);
</script>

<section>
	<header>
		<wa-avatar
			image={partner.image ?? undefined}
			initials={initialsFor(partner.name)}
			label={partner.name}
		></wa-avatar>
		<h1>{partner.name}</h1>
		{#if partner.partnerRole}
			<p class="label">{partner.yourName}'s {partner.partnerRole}</p>
		{/if}
		<TimeZoneDisplay
			timeZone={partner.timezone}
			referenceTimeZone={viewerTimezone}
			showCurrentTime={true}
		/>
	</header>

	<div class="actions">
		<wa-button
			variant="brand"
			size="l"
			href={resolve('/(auth-required)/(app)/partner/[id]/messages', { id: partner.id })}
		>
			<wa-icon slot="start" name="envelope" variant="solid"></wa-icon>
			Messages
		</wa-button>

		<wa-button
			variant="brand"
			size="l"
			href={resolve('/(auth-required)/(app)/partner/[id]/tasks', { id: partner.id })}
		>
			<wa-icon slot="start" name="list-check" variant="solid"></wa-icon>
			Tasks
		</wa-button>

		<wa-button
			variant="brand"
			size="l"
			href={resolve('/(auth-required)/(app)/partner/[id]/rewards', { id: partner.id })}
		>
			<wa-icon slot="start" name="gift" variant="solid"></wa-icon>
			Rewards
		</wa-button>
	</div>

	<a href={resolve('/(auth-required)/(app)/settings/partners/[id]', { id: partner.id })}>
		{partner.canEdit ? 'Edit this connection' : 'Connection settings'}
	</a>
</section>

<style>
	section {
		max-width: 40rem;
		margin: 0 auto;
		padding: var(--wa-space-l);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		text-align: center;

		header {
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: 0.75rem;

			wa-avatar {
				--size: 5rem;
			}

			h1 {
				margin: 0;
			}

			.label {
				margin: 0;
				color: var(--wa-color-text-quiet);
			}
		}

		p {
			margin: 0;
		}

		.actions {
			display: flex;
			gap: 1rem;
			flex-wrap: wrap;
			justify-content: center;
			width: min(100%, 32rem);

			wa-button {
				flex: 1 1 14rem;
			}
		}
	}
</style>
