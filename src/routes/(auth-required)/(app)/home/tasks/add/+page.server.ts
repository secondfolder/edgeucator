import { error, fail, redirect } from '@sveltejs/kit';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { taskEditorFormSchema } from '$lib/schemas/taskEditorForm';
import { createSelfTask } from '$lib/server/tasks';
import { taskEditorFormValuesForCreate, taskInputFromEditorForm } from '$lib/task-editor-form';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) error(401, 'Not signed in');

	return {
		taskForm: await superValidate(
			taskEditorFormValuesForCreate(locals.user.id),
			zod4(taskEditorFormSchema),
			{ errors: false }
		)
	};
};

export const actions: Actions = {
	default: async ({ locals, request }) => {
		if (!locals.user) error(401, 'Not signed in');

		const taskForm = await superValidate(request, zod4(taskEditorFormSchema));
		if (!taskForm.valid) return fail(400, { taskForm });

		await createSelfTask(
			locals.db,
			locals.user.id,
			locals.user.timezone,
			taskInputFromEditorForm(taskForm.data)
		);
		redirect(303, '/home/tasks');
	}
};
