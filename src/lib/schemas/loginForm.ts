import { z } from 'zod';

export const loginFormSchema = z.object({
	email: z.email(),
	// Deliberately not .min(8): don't advertise the password policy on the login
	// form, and never client-side reject a password that predates the policy.
	// Better Auth returns the same "invalid email or password" either way.
	password: z.string().min(1, 'Please enter your password')
});

export type LoginFormSchema = typeof loginFormSchema;
