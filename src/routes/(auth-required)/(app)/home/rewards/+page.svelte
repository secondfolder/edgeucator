<script lang="ts">
	import { resolve } from '$app/paths';
	import NestedPageHeader from '$lib/components/NestedPageHeader.svelte';
	import RewardCreditsInline from '$lib/components/RewardCreditsInline.svelte';
	import RewardList from '$lib/components/RewardList.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form?: ActionData } = $props();
	const backHref = $derived(resolve('/(auth-required)/(app)/home'));
	const selfEditHref = (rewardId: string) =>
		resolve('/(auth-required)/(app)/home/rewards/[rewardId]', { rewardId });
</script>

<section class="page">
	<NestedPageHeader
		{backHref}
		backLabel="Back to home"
		backText="Home"
		title="Rewards"
		description="Manage your own rewards here, then claim what your partners have set aside for you."
	/>

	<div class="content">
		{#if form?.message}<p class="status">{form.message}</p>{/if}
		{#if form?.error}<p class="invalid">{form.error}</p>{/if}

		<section class="panel self">
			<div class="panel-header">
				<div class="title-stack">
					<div class="title-row">
						<h2>Your Rewards</h2>
						<RewardCreditsInline
							label="Credits:"
							unit={null}
							credits={data.selfRewards.credits}
							compact
							editable={{
								action: '?/selfSetCredits',
								inputLabel: 'Set your reward credits',
								editLabel: 'Edit your reward credits',
								saveLabel: 'Save your reward credits',
								cancelLabel: 'Cancel editing reward credits'
							}}
						/>
					</div>
				</div>
				<div class="actions">
					<wa-button appearance="outlined" href={resolve('/(auth-required)/(app)/home/rewards/add')}
						>Add a reward</wa-button
					>
					{#if data.selfRewards.claims.length > 0}
						<wa-button
							appearance="outlined"
							href={resolve('/(auth-required)/(app)/home/rewards/history')}>Claim history</wa-button
						>
					{/if}
				</div>
			</div>
			<RewardList
				rewards={data.selfRewards.rewards}
				emptyMessage="You have not created any self rewards yet."
				claimAction="?/selfClaimReward"
				editHref={selfEditHref}
			/>
		</section>

		<div class="partner-sections">
			{#each data.partnerRewards as section (section.partnershipId)}
				<section class="panel partner">
					<div class="panel-header">
						<div class="title-row">
							<h2>{section.name}'s Rewards</h2>
							<RewardCreditsInline label="Credits:" unit={null} credits={section.credits} compact />
						</div>
						<a
							href={resolve('/(auth-required)/(app)/partner/[id]/rewards', {
								id: section.partnershipId
							})}>Open full rewards</a
						>
					</div>

					<RewardList
						rewards={section.rewards}
						emptyMessage={`No claimable rewards from ${section.name} right now.`}
						claimAction="?/partnerClaimReward"
						claimPartnershipId={section.partnershipId}
						editHref={null}
					/>
				</section>
			{/each}
		</div>
	</div>
</section>

<style>
	.page {
		max-width: 52rem;
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

	.panel-header,
	.actions {
		display: flex;
		gap: 0.75rem;
		align-items: end;
		flex-wrap: wrap;
	}

	.title-stack {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.title-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
		justify-content: space-between;
		width: 100%;
	}

	h2,
	p {
		margin: 0;
	}

	.panel {
		border: 1px solid var(--wa-color-surface-border);
		border-radius: var(--wa-panel-border-radius);
		padding: var(--wa-space-l);
		display: flex;
		flex-direction: column;
		gap: 1rem;
		background: color-mix(
			in srgb,
			var(--wa-color-surface-default) 94%,
			var(--wa-color-brand-fill-quiet)
		);
	}

	.partner-sections {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.status {
		color: var(--wa-color-text-success);
	}

	.invalid {
		color: var(--wa-color-text-danger);
	}

	@media (max-width: 640px) {
		.panel-header {
			flex-direction: column;
			align-items: stretch;
		}

		.title-row {
			align-items: flex-start;
		}
	}
</style>
