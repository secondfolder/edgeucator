import { z } from 'zod';

export const signupFormSchema = z
	.object({
		// Better Auth's signUpEmail requires `name`, and the generated `user`
		// table has it NOT NULL — so collect it rather than fabricating one.
		name: z.string().trim().min(1, 'Please enter a name'),
		email: z.email(),
		// Matches Better Auth's minPasswordLength, so a short password produces a
		// field-level error here instead of a generic API failure.
		password: z.string().min(8, 'Password must be at least 8 characters'),
		passwordConfirm: z.string().min(1, 'Please confirm your password')
	})
	.refine((data) => data.password === data.passwordConfirm, {
		message: "Passwords don't match",
		path: ['passwordConfirm']
	});

export type SignupFormSchema = typeof signupFormSchema;
