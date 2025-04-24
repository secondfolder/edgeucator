import { redirect } from '@sveltejs/kit'
import type { Actions } from './$types'

import { fail, setError, superValidate } from 'sveltekit-superforms';
import { zod } from 'sveltekit-superforms/adapters';
import { signupFormSchema } from '$lib/schemas/signupForm';

export const load = async () => {
    const signupForm = await superValidate(zod(signupFormSchema));

    return { signupForm };
};

export const actions: Actions = {
    default: async ({ locals, request }) => {
        const signupForm = await superValidate(request, zod(signupFormSchema));
        console.log(signupForm);

        if (!signupForm.valid) {
            return fail(400, { signupForm });
        }

        try {
			await locals.pb.collection('users').create(signupForm.data);
			await locals.pb.collection('users').authWithPassword(signupForm.data.email, signupForm.data.password);
        } catch (error) {
            console.error(error);
            return setError(signupForm, '', 'Could not signup');
        }

        redirect(303, '/')
    },
}