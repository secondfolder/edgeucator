import { error, fail } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import { setError, superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { accountFormSchema } from '$lib/schemas/accountForm';
import { updateCurrentUserProfile } from '$lib/server/user-settings';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) error(401, 'Not signed in');

	return {
		accountForm: await superValidate(
			{ name: locals.user.name, timezone: locals.user.timezone },
			zod4(accountFormSchema),
			{ errors: false }
		)
	};
};

export const actions: Actions = {
	update: async ({ locals, request }) => {
		if (!locals.user) error(401, 'Not signed in');

		const accountForm = await superValidate(request, zod4(accountFormSchema));
		if (!accountForm.valid) return fail(400, { accountForm });

		try {
			await updateCurrentUserProfile(locals.auth, request.headers, {
				name: accountForm.data.name,
				timezone: accountForm.data.timezone
			});
		} catch (caught) {
			if (caught instanceof APIError) {
				return setError(accountForm, '', caught.body?.message ?? 'Could not update your account');
			}

			console.error(caught);
			return setError(accountForm, '', 'Could not update your account');
		}

		return { accountForm };
	}
};
