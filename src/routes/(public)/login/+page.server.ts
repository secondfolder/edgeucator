import { redirect } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import { fail, setError, superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { loginFormSchema } from '$lib/schemas/loginForm';
import { redirectTargetOrHome, safeRedirect } from '$lib/safe-redirect';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	// `redirectTo` carries an invite link across sign-in. Validated on the way
	// in as well as on the way out, so a hostile value never even reaches the
	// page as a link.
	const redirectTo = safeRedirect(url.searchParams.get('redirectTo'));
	if (locals.user) redirect(303, redirectTo ?? '/home');
	return { loginForm: await superValidate(zod4(loginFormSchema)), redirectTo };
};

export const actions: Actions = {
	default: async ({ locals, request, url }) => {
		const loginForm = await superValidate(request, zod4(loginFormSchema));
		// NOTE: this used to `console.log(loginForm)`, which wrote the plaintext
		// password to the server log on every attempt. Deliberately not replaced.
		if (!loginForm.valid) {
			return fail(400, { loginForm });
		}

		try {
			// Passing only `headers` (no `request`) leaves ctx.request undefined,
			// so Better Auth's CSRF/origin middleware no-ops — this action is
			// already protected by SvelteKit's own origin check. The session
			// cookie is written onto event.cookies by the sveltekitCookies plugin.
			await locals.auth.api.signInEmail({
				body: { email: loginForm.data.email, password: loginForm.data.password },
				headers: request.headers
			});
		} catch (error) {
			if (error instanceof APIError) {
				// 401 covers both an unknown email and a wrong password, and is
				// deliberately not distinguished in the message.
				if (error.statusCode === 401) {
					return setError(loginForm, '', 'Invalid email or password');
				}
				return setError(loginForm, '', error.body?.message ?? 'Could not login');
			}
			console.error(error);
			return setError(loginForm, '', 'Could not login');
		}

		redirect(303, redirectTargetOrHome(url.searchParams.get('redirectTo')));
	}
};
