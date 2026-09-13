<script lang="ts">
	import NestedPageHeader from '$lib/components/NestedPageHeader.svelte';
	import RewardCreditsInline from '$lib/components/RewardCreditsInline.svelte';
	import RewardList from '$lib/components/RewardList.svelte';
	import { resolve } from '$app/paths';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form?: ActionData } = $props();
	const backHref = $derived(
		resolve('/(auth-required)/(app)/partner/[id]', { id: data.partner.id })
	);
	const editHref = (rewardId: string) =>
		resolve('/(auth-required)/(app)/partner/[id]/rewards/[rewardId]', {
			id: data.partner.id,
			rewardId
		});
	const description = $derived(
		data.partner.canManageRewards && data.partner.canClaimRewards
			? 'You can manage this reward list and claim rewards your partner created.'
			: data.partner.canManageRewards
				? 'You control this reward list and set the credits they can spend.'
				: 'You can claim rewards from this list when you have enough credits.'
	);
</script>

<section class="page">
	<NestedPageHeader
		{backHref}
		backLabel="Back to partner"
		backText={data.partner.name}
		title="Rewards"
		{description}
	/>

	<div class="content">
		<nav class="links">
			{#if data.partner.canManageRewards}
				<wa-button
					appearance="outlined"
					href={resolve('/(auth-required)/(app)/partner/[id]/rewards/add', { id: data.partner.id })}
					>Add a reward</wa-button
				>
			{/if}
			{#if data.claims.length > 0}
				<wa-button
					appearance="outlined"
					href={resolve('/(auth-required)/(app)/partner/[id]/rewards/history', {
						id: data.partner.id
					})}>Claim history</wa-button
				>
			{/if}
		</nav>

		{#if form?.message}<p class="status">{form.message}</p>{/if}
		{#if form?.error}<p class="invalid">{form.error}</p>{/if}

		<section class="panel">
			<div class="panel-header">
				<div class="title-row">
					<h2>{data.partner.canClaimRewards ? 'Rewards' : `${data.partner.name}'s Rewards`}</h2>
					{#if data.partner.canClaimRewards}
						<RewardCreditsInline credits={data.viewerCredits} compact />
					{:else if data.counterpartCredits !== null && data.counterpartUserId}
						<RewardCreditsInline
							label="Credits:"
							unit={null}
							credits={data.counterpartCredits}
							compact
							editable={{
								action: '?/setCredits',
								inputLabel: `Set ${data.partner.name}'s reward credits`,
								editLabel: `Edit ${data.partner.name}'s reward credits`,
								saveLabel: `Save ${data.partner.name}'s reward credits`,
								cancelLabel: 'Cancel editing reward credits',
								targetUserId: data.counterpartUserId
							}}
						/>
					{/if}
				</div>
			</div>

			{#if data.partner.canClaimRewards && data.counterpartCredits !== null && data.counterpartUserId}
				<div class="secondary-credit-row">
					<RewardCreditsInline
						label={`${data.partner.name}'s credits`}
						credits={data.counterpartCredits}
						editable={{
							action: '?/setCredits',
							inputLabel: `Set ${data.partner.name}'s reward credits`,
							editLabel: `Edit ${data.partner.name}'s reward credits`,
							saveLabel: `Save ${data.partner.name}'s reward credits`,
							cancelLabel: 'Cancel editing reward credits',
							targetUserId: data.counterpartUserId
						}}
					/>
				</div>
			{/if}

			<RewardList
				rewards={data.rewards}
				emptyMessage="No rewards have been created for this partnership yet."
				claimAction="?/claimReward"
				editHref={data.partner.canManageRewards ? editHref : null}
				showClaimUi={data.partner.canClaimRewards}
			/>
		</section>
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

	.links {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.panel-header,
	.title-row,
	.secondary-credit-row {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.title-row {
		align-items: center;
		justify-content: space-between;
		width: 100%;
	}

	.secondary-credit-row {
		padding-block-end: 0.25rem;
		border-block-end: 1px solid color-mix(in srgb, var(--wa-color-surface-border) 75%, transparent);
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

	h2,
	p {
		margin: 0;
	}

	.status {
		color: var(--wa-color-text-success);
	}

	.invalid {
		color: var(--wa-color-text-danger);
	}

	@media (max-width: 640px) {
		.title-row {
			align-items: flex-start;
		}
	}
</style>
