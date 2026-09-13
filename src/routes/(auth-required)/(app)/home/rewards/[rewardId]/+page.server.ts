import { error, fail, redirect } from '@sveltejs/kit';
import { rewardFormSchema } from '$lib/schemas/rewardForm';
import { getSelfRewardForUser, updateSelfReward } from '$lib/server/rewards';
import type { Actions, PageServerLoad } from './$types';

function stringField(formData: FormData, key: string): string | undefined {
	const value = formData.get(key);
	return typeof value === 'string' ? value : undefined;
}

function nullableStringField(formData: FormData, key: string): string | null {
	const value = formData.get(key);
	return typeof value === 'string' ? value : null;
}

function numberField(formData: FormData, key: string): string | undefined {
	const value = stringField(formData, key);
	return value === '' ? undefined : value;
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

function parseRewardForm(formData: FormData) {
	return rewardFormSchema.safeParse({
		title: stringField(formData, 'title'),
		description: nullableStringField(formData, 'description'),
		cost: numberField(formData, 'cost'),
		active: formData.get('active') === 'on'
	});
}

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.user) error(401, 'Not signed in');

	const reward = await getSelfRewardForUser(locals.db, locals.user.id, params.rewardId);
	if (!reward) error(404, 'Reward not found');

	return { reward };
};

export const actions: Actions = {
	default: async ({ locals, params, request }) => {
		if (!locals.user) error(401, 'Not signed in');

		const formData = await request.formData();
		const parsed = parseRewardForm(formData);
		if (!parsed.success) {
			const flat = parsed.error.flatten();
			return fail(400, {
				error: firstError(flat.fieldErrors, flat.formErrors),
				values: {
					title: stringField(formData, 'title') ?? '',
					description: stringField(formData, 'description') ?? '',
					cost: stringField(formData, 'cost') ?? '',
					active: formData.get('active') === 'on'
				}
			});
		}

		const updated = await updateSelfReward(locals.db, locals.user.id, params.rewardId, parsed.data);
		if (!updated) error(404, 'Reward not found');

		redirect(303, '/home/rewards');
	}
};
