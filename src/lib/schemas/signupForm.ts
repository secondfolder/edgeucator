import { z } from 'zod';

export const signupFormSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
    passwordConfirm: z.string().min(1),
})
.refine((data) => data.password === data.passwordConfirm, {
  message: "Passwords don't match",
  path: ['passwordConfirm'],
});;

export type SignupFormSchema = typeof signupFormSchema;