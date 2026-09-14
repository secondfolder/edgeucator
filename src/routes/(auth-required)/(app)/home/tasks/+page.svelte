<script lang="ts">
	import { resolve } from '$app/paths';
	import NestedPageHeader from '$lib/components/NestedPageHeader.svelte';
	import TaskListSection from '$lib/components/TaskListSection.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form?: ActionData } = $props();
	const backHref = $derived(resolve('/(auth-required)/(app)/home'));
	const historyHref = $derived(resolve('/(auth-required)/(app)/home/tasks/history'));
	const hasPartnerSections = $derived(data.partnerTasks.length > 0);
	const selfEditHref = (taskId: string) =>
		resolve('/(auth-required)/(app)/home/tasks/[taskId]', { taskId });
</script>

<section class="page">
	<NestedPageHeader
		{backHref}
		backLabel="Back to home"
		backText="Home"
		title="Tasks"
		description="Track your own tasks here, then see the partner tasks currently assigned to you."
	/>

	<div class="content">
		{#if form?.message}<p class="status">{form.message}</p>{/if}
		{#if form?.error}<p class="invalid">{form.error}</p>{/if}

		<TaskListSection
			title="Your Tasks"
			tasks={data.selfTasks.tasks}
			emptyMessage="You have not created any self tasks yet."
			completeAction="?/selfCompleteTask"
			editHref={selfEditHref}
			{historyHref}
			addHref={resolve('/(auth-required)/(app)/home/tasks/add')}
			wrapInPanel={hasPartnerSections}
		/>

		<div class="partner-sections">
			{#each data.partnerTasks as section (section.partnershipId)}
				<TaskListSection
					title={`${section.name}'s Tasks`}
					tasks={section.tasks}
					emptyMessage={`No active tasks from ${section.name} right now.`}
					completeAction="?/partnerCompleteTask"
					completePartnershipId={section.partnershipId}
					extraHref={resolve('/(auth-required)/(app)/partner/[id]/tasks', {
						id: section.partnershipId
					})}
					extraLabel="Open full task list"
					wrapInPanel={true}
				/>
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

	.content,
	.partner-sections {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.content {
		padding: 0 var(--wa-space-l) var(--wa-space-l);
	}

	.status {
		color: var(--wa-color-text-success);
	}

	.invalid {
		color: var(--wa-color-text-danger);
	}
</style>
