<script lang="ts">
	import { resolve } from '$app/paths';
	import NestedPageHeader from '$lib/components/NestedPageHeader.svelte';
	import RewardForm from '$lib/components/RewardForm.svelte';
	import type { ActionData } from './$types';

	let { form }: { form?: ActionData } = $props();
	const values = $derived(form?.values ?? { title: '', description: '', cost: '', active: true });
	const backHref = $derived(resolve('/(auth-required)/(app)/home/rewards'));
</script>

<section class="page">
	<NestedPageHeader
		{backHref}
		backLabel="Back to rewards"
		backText="Rewards"
		title="Add a self reward"
		description="This reward belongs only to you and spends from your own self-reward credit balance."
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
