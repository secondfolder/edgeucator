import { error, fail, redirect } from '@sveltejs/kit';
import { setError, superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { taskEditorFormSchema } from '$lib/schemas/taskEditorForm';
import { createPartnershipTask, getPartnershipTasksPage } from '$lib/server/tasks';
import { taskEditorFormValuesForCreate, taskInputFromEditorForm } from '$lib/task-editor-form';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.user) error(401, 'Not signed in');
	const page = await getPartnershipTasksPage(
		locals.db,
		params.id,
		locals.user.id,
		locals.user.timezone
	);
	if (!page) error(404, 'Partner not found');
	if (!page.partner.canManageTasks) error(403, 'Only the controlling side can add tasks here.');
	return {
		...page,
		taskForm: await superValidate(
			taskEditorFormValuesForCreate(page.partner.counterpartUserId),
			zod4(taskEditorFormSchema),
			{ errors: false }
		)
	};
};

export const actions: Actions = {
	default: async ({ locals, params, request }) => {
		if (!locals.user) error(401, 'Not signed in');
		const page = await getPartnershipTasksPage(
			locals.db,
			params.id,
			locals.user.id,
			locals.user.timezone
		);
		if (!page) error(404, 'Partner not found');
		if (!page.partner.canManageTasks) error(403, 'Only the controlling side can add tasks here.');

		const taskForm = await superValidate(request, zod4(taskEditorFormSchema));
		if (!taskForm.valid) return fail(400, { taskForm });

		const result = await createPartnershipTask(
			locals.db,
			params.id,
			locals.user.id,
			locals.user.timezone,
			taskInputFromEditorForm(taskForm.data)
		);
		if (!result.ok) {
			return setError(
				taskForm,
				'',
				result.reason === 'bad-timezone-owner'
					? 'That timezone selection does not match this partnership.'
					: 'Only the controlling side can add tasks here.'
			);
		}

		redirect(303, `/partner/${params.id}/tasks`);
	}
};
