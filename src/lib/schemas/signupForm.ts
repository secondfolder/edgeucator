import { z } from 'zod';
import { authSecretField, identityFields } from './keyWrap';
import { timezoneField } from './timezone';

export const signupFormSchema = z.object({
	// Better Auth's signUpEmail requires `name`, and the generated `user`
	// table has it NOT NULL — so collect it rather than fabricating one.
	name: z.string().trim().min(1, 'Please enter a name'),
	email: z.email(),
	timezone: timezoneField,
	/**
	 * The `password` and `passwordConfirm` fields are gone, and not by
	 * oversight: the server no longer receives a password, so it cannot check
	 * that two copies matched or that either was long enough. Both checks moved
	 * into `SignupForm.svelte`, which is the only place that sees them.
	 */
	authSecret: authSecretField,
	// The identity generated in the browser during the same submit. Opaque here.
	...identityFields
});

export type SignupFormSchema = typeof signupFormSchema;
