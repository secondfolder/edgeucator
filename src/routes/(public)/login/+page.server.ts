import { redirect } from '@sveltejs/kit'
import type { Actions } from './$types'

import { fail, setError, superValidate } from 'sveltekit-superforms';
import { zod } from 'sveltekit-superforms/adapters';
import { loginFormSchema } from '$lib/schemas/loginForm';
import { ClientResponseError } from 'pocketbase';

export const load = async () => {
    const loginForm = await superValidate(zod(loginFormSchema));

    return { loginForm };
};

export const actions: Actions = {
    default: async ({ locals, request }) => {
        const loginForm = await superValidate(request, zod(loginFormSchema));
        console.log(loginForm);

        if (!loginForm.valid) {
            return fail(400, { loginForm });
        }

        try {
            await locals.pb
                .collection('users')
                .authWithPassword(loginForm.data.email, loginForm.data.password)
        } catch (error) {
            if (error instanceof ClientResponseError && error.status === 400) {
                return setError(loginForm, '', 'Invalid email or password');
            }
            console.error(error);
            return setError(loginForm, '', 'Could not login');
        }

        redirect(303, '/')
    },
}