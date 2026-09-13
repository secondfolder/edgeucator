<script lang="ts">
	import { resolve } from '$app/paths';
	import NestedPageHeader from '$lib/components/NestedPageHeader.svelte';
	import RewardForm from '$lib/components/RewardForm.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form?: ActionData } = $props();
	const values = $derived(
		form?.values ?? {
			title: data.reward.title,
			description: data.reward.description ?? '',
			cost: String(data.reward.cost),
			active: data.reward.active
		}
	);
	const backHref = $derived(resolve('/(auth-required)/(app)/home/rewards'));
</script>

<section class="page">
	<NestedPageHeader
		{backHref}
		backLabel="Back to rewards"
		backText="Rewards"
		title="Edit self reward"
		description="Use the same reward form here that creates a new self reward, but with the current values prefilled."
	/>

	<div class="content">
		{#if form?.error}<p class="invalid">{form.error}</p>{/if}
		<RewardForm {values} submitLabel="Save reward" />
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

	.invalid {
		color: var(--wa-color-text-danger);
	}
</style>
