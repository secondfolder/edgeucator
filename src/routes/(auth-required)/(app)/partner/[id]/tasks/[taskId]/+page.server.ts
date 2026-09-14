import { error, fail } from '@sveltejs/kit';
import { message, setError, superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { taskEditorFormSchema } from '$lib/schemas/taskEditorForm';
import { getPartnershipTaskForUser, updatePartnershipTask } from '$lib/server/tasks';
import { taskEditorFormValuesFromTask, taskInputFromEditorForm } from '$lib/task-editor-form';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.user) error(401, 'Not signed in');
	const data = await getPartnershipTaskForUser(
		locals.db,
		params.id,
		locals.user.id,
		locals.user.timezone,
		params.taskId
	);
	if (!data) error(404, 'Task not found');
	if (!data.partner.canManageTasks || !data.task.createdByMe)
		error(403, 'Only the partner who created a task can edit it.');
	return {
		partner: data.partner,
		taskForm: await superValidate(
			taskEditorFormValuesFromTask(data.task),
			zod4(taskEditorFormSchema),
			{
				errors: false
			}
		)
	};
};

export const actions: Actions = {
	default: async ({ locals, params, request }) => {
		if (!locals.user) error(401, 'Not signed in');
		const current = await getPartnershipTaskForUser(
			locals.db,
			params.id,
			locals.user.id,
			locals.user.timezone,
			params.taskId
		);
		if (!current) error(404, 'Task not found');
		if (!current.partner.canManageTasks || !current.task.createdByMe)
			error(403, 'Only the partner who created a task can edit it.');

		const taskForm = await superValidate(request, zod4(taskEditorFormSchema));
		if (!taskForm.valid) return fail(400, { taskForm });

		const result = await updatePartnershipTask(
			locals.db,
			params.id,
			locals.user.id,
			locals.user.timezone,
			params.taskId,
			taskInputFromEditorForm(taskForm.data)
		);
		if (!result.ok) {
			if (result.reason === 'not-a-member') error(404, 'Partner not found');
			if (result.reason === 'not-found') error(404, 'Task not found');
			return setError(
				taskForm,
				'',
				result.reason === 'bad-timezone-owner'
					? 'That timezone selection does not match this partnership.'
					: 'Only the partner who created a task can edit it.'
			);
		}

		return message(taskForm, 'Task saved.');
	}
};
