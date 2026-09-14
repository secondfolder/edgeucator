<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import NestedPageHeader from '$lib/components/NestedPageHeader.svelte';
	import TaskForm from '$lib/components/TaskForm.svelte';
	import { taskEditorFormSchema } from '$lib/schemas/taskEditorForm';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import { superForm } from 'sveltekit-superforms';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const backHref = $derived(resolve('/(auth-required)/(app)/home/tasks'));
	// svelte-ignore state_referenced_locally
	// Captures the load's initial task form on purpose: `superForm` owns the
	// live state afterwards and failed submissions should stay populated.
	const superform = superForm(data.taskForm, {
		resetForm: false,
		validators: zod4Client(taskEditorFormSchema),
		async onUpdated({ form }) {
			if (!form.valid) return;
			await invalidateAll();
		}
	});
	const { message } = superform;
</script>

<section class="page">
	<NestedPageHeader
		{backHref}
		backLabel="Back to tasks"
		backText="Tasks"
		title="Edit self task"
		description="Update your task details, schedule, and reward credits here."
	/>

	<div class="content">
		{#if $message}<p class="status">{$message}</p>{/if}
		<TaskForm {superform} submitLabel="Save task" />
	</div>
</section>

<style>
	.page {
		max-width: 48rem;
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
</style>
