<script lang="ts">
	import { resolve } from '$app/paths';
	import NestedPageHeader from '$lib/components/NestedPageHeader.svelte';
	import RichText from '$lib/components/RichText.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const backHref = $derived(
		resolve('/(auth-required)/(app)/partner/[id]/rewards', { id: data.partner.id })
	);
</script>

<section class="page">
	<NestedPageHeader
		{backHref}
		backLabel="Back to rewards"
		backText="Rewards"
		title={`${data.partner.name}'s reward history`}
		description="Every claim is snapshotted with the title and cost it had at the time."
	/>

	<div class="content">
		<section class="panel">
			<h2>Claim history</h2>
			{#if data.claims.length === 0}
				<p class="empty">Nothing claimed yet.</p>
			{:else}
				<ul class="history-list">
					{#each data.claims as claim (claim.id)}
						<li>
							<div class="reward-head">
								<div>
									<h3>{claim.rewardTitle}</h3>
									<p>{claim.rewardCost} credits</p>
								</div>
								<span class="pill">{claim.mine ? 'Claimed by you' : 'Claimed by them'}</span>
							</div>
							{#if claim.rewardDescription}
								<div class="description"><RichText text={claim.rewardDescription} /></div>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	</div>
</section>

<style>
	.page {
		max-width: 40rem;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.content {
		padding: 0 var(--wa-space-l) var(--wa-space-l);
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	h2,
	.reward-head h3,
	.reward-head p {
		margin: 0;
	}

	.empty,
	.pill {
		color: var(--wa-color-text-quiet);
	}

	.panel {
		border: 1px solid var(--wa-color-surface-border);
		border-radius: var(--wa-panel-border-radius);
		padding: var(--wa-space-l);
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.history-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.history-list li {
		border: 1px solid color-mix(in srgb, var(--wa-color-surface-border) 75%, transparent);
		border-radius: 0.75rem;
		padding: 0.85rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.reward-head {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: flex-start;
		flex-wrap: wrap;
	}
</style>
