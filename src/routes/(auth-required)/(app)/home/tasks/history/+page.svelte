<script lang="ts">
	import { resolve } from '$app/paths';
	import NestedPageHeader from '$lib/components/NestedPageHeader.svelte';
	import TaskCompletionList from '$lib/components/TaskCompletionList.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const backHref = $derived(resolve('/(auth-required)/(app)/home/tasks'));
</script>

<section class="page">
	<NestedPageHeader
		{backHref}
		backLabel="Back to tasks"
		backText="Tasks"
		title="Self task history"
		description="Each completion keeps the title, credits, and message it had at the time."
	/>

	<div class="content">
		<section class="panel">
			<h2>Completion history</h2>
			<TaskCompletionList
				completions={data.selfTasks.completions}
				emptyMessage="No self tasks have been completed yet."
			/>
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

	.panel {
		border: 1px solid var(--wa-color-surface-border);
		border-radius: var(--wa-panel-border-radius);
		padding: var(--wa-space-l);
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
</style>
