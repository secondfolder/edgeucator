<script lang="ts">
	import { resolve } from '$app/paths';
	import NestedPageHeader from '$lib/components/NestedPageHeader.svelte';
	import RewardForm from '$lib/components/RewardForm.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form?: ActionData } = $props();
	const values = $derived(form?.values ?? { title: '', description: '', cost: '', active: true });
	const backHref = $derived(
		resolve('/(auth-required)/(app)/partner/[id]/rewards', { id: data.partner.id })
	);
</script>

<section class="page">
	<NestedPageHeader
		{backHref}
		backLabel="Back to rewards"
		backText="Rewards"
		title={`Add a reward for ${data.partner.name}`}
		description="Rewards are created on the partnership, but only your partner can claim the ones you author."
	/>

	<div class="content">
		{#if form?.error}<p class="invalid">{form.error}</p>{/if}

		<RewardForm {values} submitLabel="Add reward" />
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
