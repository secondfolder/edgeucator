<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import NestedPageHeader from '$lib/components/NestedPageHeader.svelte';
	import TaskForm from '$lib/components/TaskForm.svelte';
	import { taskEditorFormSchema } from '$lib/schemas/taskEditorForm';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import { superForm } from 'sveltekit-superforms';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const backHref = $derived(
		resolve('/(auth-required)/(app)/partner/[id]/tasks', { id: data.partner.id })
	);
	// svelte-ignore state_referenced_locally
	// Captures the load's initial task form on purpose: `superForm` owns the
	// live state afterwards and failed submissions should stay populated.
	const superform = superForm(data.taskForm, {
		resetForm: false,
		validators: zod4Client(taskEditorFormSchema)
	});
	const timeZoneContext = $derived(
		page.data.user
			? {
					viewerUserId: page.data.user.id,
					viewerTimezone: page.data.user.timezone,
					counterpartUserId: data.partner.counterpartUserId,
					counterpartTimezone: data.partner.counterpartTimezone,
					counterpartName: data.partner.name
				}
			: null
	);
</script>

<section class="page">
	<NestedPageHeader
		{backHref}
		backLabel="Back to tasks"
		backText={data.partner.name}
		title="Add a partner task"
		description="This task belongs to the partnership and awards credits to whoever completes it."
	/>

	<div class="content">
		<TaskForm {superform} submitLabel="Add task" {timeZoneContext} />
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
</style>
