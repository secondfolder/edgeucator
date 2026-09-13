import { error, fail, redirect } from '@sveltejs/kit';
import { rewardFormSchema } from '$lib/schemas/rewardForm';
import { getPartnershipRewardForUser, updatePartnershipReward } from '$lib/server/rewards';
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

	const result = await getPartnershipRewardForUser(
		locals.db,
		params.id,
		locals.user.id,
		params.rewardId
	);
	if (!result) error(404, 'Reward not found');
	if (!result.partner.canManageRewards)
		error(403, 'Only the controlling side can edit rewards here.');

	return result;
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

		const result = await updatePartnershipReward(
			locals.db,
			params.id,
			locals.user.id,
			params.rewardId,
			parsed.data
		);
		if (!result.ok) {
			if (result.reason === 'not-a-member') error(404, 'Partner not found');
			if (result.reason === 'not-found') error(404, 'Reward not found');
			return fail(403, {
				error: 'Only the controlling side can edit rewards here.',
				values: {
					...parsed.data,
					description: parsed.data.description ?? '',
					cost: String(parsed.data.cost)
				}
			});
		}

		redirect(303, `/partner/${params.id}/rewards`);
	}
};
