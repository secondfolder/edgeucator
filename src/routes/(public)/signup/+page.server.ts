import { redirect } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import { fail, setError, superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { signupFormSchema } from '$lib/schemas/signupForm';
import { redirectTargetOrHome, safeRedirect } from '$lib/safe-redirect';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	// See the note in the login load: this is how an invite survives signup.
	const redirectTo = safeRedirect(url.searchParams.get('redirectTo'));
	if (locals.user) redirect(303, redirectTo ?? '/home');
	return { signupForm: await superValidate(zod4(signupFormSchema)), redirectTo };
};

export const actions: Actions = {
	default: async ({ locals, request, url }) => {
		const signupForm = await superValidate(request, zod4(signupFormSchema));
		// (the previous console.log here also leaked the plaintext password)
		if (!signupForm.valid) {
			return fail(400, { signupForm });
		}

		const { name, email, password } = signupForm.data;
		try {
			// autoSignIn is on and email verification is off, so this both creates
			// the user and establishes the session — the old create-then-
			// authenticate pair is no longer needed.
			await locals.auth.api.signUpEmail({
				body: { name, email, password },
				headers: request.headers
			});
		} catch (error) {
			if (error instanceof APIError) {
				const code = error.body?.code;
				if (code === 'USER_ALREADY_EXISTS' || code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL') {
					return setError(signupForm, 'email', 'An account with that email already exists');
				}
				if (code === 'PASSWORD_TOO_SHORT' || code === 'PASSWORD_TOO_LONG') {
					return setError(signupForm, 'password', error.body?.message ?? 'Invalid password');
				}
				return setError(signupForm, '', error.body?.message ?? 'Could not sign up');
			}
			console.error(error);
			return setError(signupForm, '', 'Could not sign up');
		}

		redirect(303, redirectTargetOrHome(url.searchParams.get('redirectTo')));
	}
};
