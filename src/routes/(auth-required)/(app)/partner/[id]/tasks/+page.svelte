<script lang="ts">
	import { resolve } from '$app/paths';
	import NestedPageHeader from '$lib/components/NestedPageHeader.svelte';
	import TaskListSection from '$lib/components/TaskListSection.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form?: ActionData } = $props();
	const backHref = $derived(
		resolve('/(auth-required)/(app)/partner/[id]', { id: data.partner.id })
	);
	const addTaskHref = $derived(
		resolve('/(auth-required)/(app)/partner/[id]/tasks/add', { id: data.partner.id })
	);
	const historyHref = $derived(
		resolve('/(auth-required)/(app)/partner/[id]/tasks/history', { id: data.partner.id })
	);
	const editHref = (taskId: string) =>
		resolve('/(auth-required)/(app)/partner/[id]/tasks/[taskId]', { id: data.partner.id, taskId });
	const hasSharedControl = $derived(data.partner.canManageTasks && data.partner.canCompleteTasks);
	const tasksForViewer = $derived(data.tasks.filter((task) => !task.createdByMe));
	const tasksForPartner = $derived(data.tasks.filter((task) => task.createdByMe));
	const description = $derived(
		data.partner.canManageTasks && data.partner.canCompleteTasks
			? 'You can manage this task list and complete the tasks your partner created.'
			: data.partner.canManageTasks
				? 'You control this task list and set the tasks your partner can complete.'
				: 'You can complete tasks from this list when they are available.'
	);
</script>

<section class="page">
	<NestedPageHeader
		{backHref}
		backLabel="Back to partner"
		backText={data.partner.name}
		title="Tasks"
		{description}
	/>

	<div class="content">
		{#if form?.message}<p class="status">{form.message}</p>{/if}
		{#if form?.error}<p class="invalid">{form.error}</p>{/if}

		{#if hasSharedControl}
			<TaskListSection
				title="Tasks for you"
				tasks={tasksForViewer}
				emptyMessage={`No tasks are assigned to you from ${data.partner.name} right now.`}
				completeAction="?/completeTask"
				{historyHref}
				{editHref}
			/>

			<TaskListSection
				title={`Tasks for ${data.partner.name}`}
				tasks={tasksForPartner}
				emptyMessage={`You have not assigned any tasks to ${data.partner.name} yet.`}
				completeAction="?/completeTask"
				{historyHref}
				addHref={addTaskHref}
				{editHref}
			/>
		{:else}
			<TaskListSection
				title={data.partner.canCompleteTasks ? 'Tasks' : `${data.partner.name}'s Tasks`}
				tasks={data.tasks}
				emptyMessage="No tasks have been created for this partnership yet."
				completeAction="?/completeTask"
				{historyHref}
				addHref={data.partner.canManageTasks ? addTaskHref : null}
				wrapInPanel={false}
				{editHref}
			/>
		{/if}
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

	.status {
		color: var(--wa-color-text-success);
	}

	.invalid {
		color: var(--wa-color-text-danger);
	}
</style>
