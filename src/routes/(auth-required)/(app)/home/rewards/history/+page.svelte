<script lang="ts">
	import { resolve } from '$app/paths';
	import NestedPageHeader from '$lib/components/NestedPageHeader.svelte';
	import RichText from '$lib/components/RichText.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const backHref = $derived(resolve('/(auth-required)/(app)/home/rewards'));
</script>

<section class="page">
	<NestedPageHeader
		{backHref}
		backLabel="Back to rewards"
		backText="Rewards"
		title="Self reward history"
		description="Each claim keeps the title and cost it had when you redeemed it."
	/>

	<div class="content">
		<section class="panel">
			<h2>Claim history</h2>
			{#if data.selfRewards.claims.length === 0}
				<p class="empty">Nothing claimed yet.</p>
			{:else}
				<ul class="history-list">
					{#each data.selfRewards.claims as claim (claim.id)}
						<li>
							<strong>{claim.rewardTitle}</strong>
							<span>{claim.rewardCost} credits</span>
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

	h2 {
		margin: 0;
	}

	.empty {
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
		gap: 0.35rem;
	}
</style>
