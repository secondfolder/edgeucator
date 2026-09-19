<script lang="ts">
	import { untrack } from 'svelte';
	// LEGACY-RICHTEXT — delete with the legacy reader; see docs/temporary-code.md
	import { migrateLegacyDescriptions } from '$lib/richtext-legacy-migrate';
	import RichText from '$lib/components/RichText.svelte';
	import type { PartnershipRewardView, SelfRewardView } from '$lib/types';

	type RewardView = SelfRewardView | PartnershipRewardView;
	type EditHrefBuilder = ((rewardId: string) => string) | null;

	let {
		rewards,
		emptyMessage,
		claimAction,
		claimPartnershipId = null,
		editHref = null,
		showClaimUi = true
	}: {
		rewards: RewardView[];
		emptyMessage: string;
		claimAction: string;
		claimPartnershipId?: string | null;
		editHref?: EditHrefBuilder;
		showClaimUi?: boolean;
	} = $props();

	function rewardCreatedByMe(reward: RewardView): boolean {
		return 'createdByMe' in reward ? reward.createdByMe : false;
	}

	/**
	 * LEGACY-RICHTEXT — quietly convert any pre-rich-text descriptions the
	 * viewer is allowed to edit. `editHref` being set is the client-side proxy
	 * for "can edit"; the server re-checks it properly. Read untracked so this
	 * does not re-run on every unrelated update.
	 */
	$effect(() => {
		if (!editHref) return;
		void migrateLegacyDescriptions({
			kind: claimPartnershipId ? 'partnership-reward' : 'self-reward',
			partnershipId: claimPartnershipId,
			items: untrack(() =>
				rewards.map((reward) => ({ id: reward.id, description: reward.description }))
			)
		});
	});
</script>

{#if rewards.length === 0}
	<p class="empty">{emptyMessage}</p>
{:else}
	<ul class="reward-list">
		{#each rewards as reward (reward.id)}
			<li class:inactive={!reward.active}>
				<div class="reward-head">
					<div>
						<h3>{reward.title}</h3>
						<p>{reward.cost} credits</p>
					</div>
					<div class="reward-meta">
						{#if editHref}
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
							<a class="icon-link" href={editHref(reward.id)} aria-label={`Edit ${reward.title}`}>
								<wa-icon name="pen-to-square" variant="solid"></wa-icon>
							</a>
						{/if}
					</div>
				</div>

				{#if reward.description}<div class="description">
						<RichText text={reward.description} />
					</div>{/if}

				{#if showClaimUi && !rewardCreatedByMe(reward)}
					<form method="POST" action={claimAction} class="claim-form">
						{#if claimPartnershipId}
							<input type="hidden" name="partnershipId" value={claimPartnershipId} />
						{/if}
						<input type="hidden" name="rewardId" value={reward.id} />
						<wa-button type="submit" size="s" disabled={!reward.canClaim}>Claim</wa-button>
						<span class="quiet">
							{#if !reward.active}
								Inactive right now.
							{:else if !reward.canClaim}
								You need {reward.cost} credits.
							{:else}
								Ready to claim.
							{/if}
						</span>
					</form>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

<style>
	h3,
	p {
		margin: 0;
	}

	.reward-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.reward-list li {
		border: 1px solid color-mix(in srgb, var(--wa-color-surface-border) 75%, transparent);
		border-radius: 0.75rem;
		padding: 0.85rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.reward-head,
	.claim-form,
	.reward-meta {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.reward-head {
		justify-content: space-between;
		align-items: flex-start;
	}

	.reward-meta {
		align-items: center;
	}

	.claim-form {
		align-items: center;
	}

	.quiet,
	.empty {
		color: var(--wa-color-text-quiet);
	}

	.icon-link {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		inline-size: 2.25rem;
		block-size: 2.25rem;
		border: 1px solid var(--wa-color-surface-border);
		border-radius: 999px;
		text-decoration: none;
		color: var(--wa-color-text-quiet);
	}

	.inactive {
		opacity: 0.7;
	}
</style>
