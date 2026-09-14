<script lang="ts">
	import type { Infer, SuperValidated } from 'sveltekit-superforms';
	import { superForm } from 'sveltekit-superforms';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import TaskForm from '$lib/components/TaskForm.svelte';
	import { taskEditorFormSchema, type TaskEditorFormSchema } from '$lib/schemas/taskEditorForm';

	type TimeZoneContext = {
		viewerUserId: string;
		viewerTimezone: string;
		counterpartUserId: string;
		counterpartTimezone: string;
		counterpartName: string;
	};

	let {
		data,
		submitLabel,
		timeZoneContext = null
	}: {
		data: SuperValidated<Infer<TaskEditorFormSchema>>;
		submitLabel: string;
		timeZoneContext?: TimeZoneContext | null;
	} = $props();

	// svelte-ignore state_referenced_locally
	const superform = superForm(data, {
		resetForm: false,
		warnings: {
			duplicateId: false
		},
		validators: zod4Client(taskEditorFormSchema)
	});
</script>

<TaskForm {superform} {submitLabel} {timeZoneContext} />
