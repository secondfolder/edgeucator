import { error, fail } from '@sveltejs/kit';
import { message, superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { taskEditorFormSchema } from '$lib/schemas/taskEditorForm';
import { getSelfTaskForUser, updateSelfTask } from '$lib/server/tasks';
import { taskEditorFormValuesFromTask, taskInputFromEditorForm } from '$lib/task-editor-form';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.user) error(401, 'Not signed in');
	const task = await getSelfTaskForUser(
		locals.db,
		locals.user.id,
		locals.user.timezone,
		params.taskId
	);
	if (!task) error(404, 'Task not found');
	return {
		taskForm: await superValidate(taskEditorFormValuesFromTask(task), zod4(taskEditorFormSchema), {
			errors: false
		})
	};
};

export const actions: Actions = {
	default: async ({ locals, params, request }) => {
		if (!locals.user) error(401, 'Not signed in');

		const taskForm = await superValidate(request, zod4(taskEditorFormSchema));
		if (!taskForm.valid) return fail(400, { taskForm });

		const updated = await updateSelfTask(
			locals.db,
			locals.user.id,
			locals.user.timezone,
			params.taskId,
			taskInputFromEditorForm(taskForm.data)
		);
		if (!updated) error(404, 'Task not found');
		return message(taskForm, 'Task saved.');
	}
};
