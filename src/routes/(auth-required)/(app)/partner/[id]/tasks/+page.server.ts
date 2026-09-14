import { error, fail } from '@sveltejs/kit';
import { taskCompleteSchema } from '$lib/schemas/taskForm';
import { completePartnershipTask, getPartnershipTasksPage } from '$lib/server/tasks';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, depends }) => {
	if (!locals.user) error(401, 'Not signed in');

	depends(`tasks:partner:${params.id}`);

	const page = await getPartnershipTasksPage(
		locals.db,
		params.id,
		locals.user.id,
		locals.user.timezone
	);
	if (!page) error(404, 'Partner not found');
	return page;
};

function stringField(formData: FormData, key: string): string | undefined {
	const value = formData.get(key);
	return typeof value === 'string' ? value : undefined;
}

function firstError(
	fieldErrors: Record<string, string[] | undefined>,
	formErrors: string[]
): string {
	for (const errorList of Object.values(fieldErrors)) {
		if (errorList?.[0]) return errorList[0];
	}
	return formErrors[0] ?? 'Please check the form and try again.';
}

export const actions: Actions = {
	completeTask: async ({ locals, params, request }) => {
		if (!locals.user) error(401, 'Not signed in');
		const formData = await request.formData();
		const parsed = taskCompleteSchema.safeParse({ taskId: stringField(formData, 'taskId') });
		if (!parsed.success) {
			const flat = parsed.error.flatten();
			return fail(400, { error: firstError(flat.fieldErrors, flat.formErrors) });
		}

		const result = await completePartnershipTask(locals.db, {
			partnershipId: params.id,
			taskId: parsed.data.taskId,
			userId: locals.user.id,
			viewerTimezone: locals.user.timezone
		});
		if (!result.ok) {
			if (result.reason === 'not-a-member') error(404, 'Partner not found');
			if (result.reason === 'not-found') error(404, 'Task not found');
			if (result.reason === 'not-allowed' || result.reason === 'own-task') {
				return fail(403, {
					error: 'You cannot complete that task from this side of the partnership.'
				});
			}
			return fail(400, {
				error:
					result.reason === 'inactive'
						? 'That task is inactive right now.'
						: 'That task is not ready to complete yet.'
			});
		}

		return { message: 'Task completed.' };
	}
};
