import { z } from 'zod';

export const accountFormSchema = z.object({
	name: z
		.string()
		.trim()
		.min(1, 'Please enter a name')
		.max(60, 'Keep your name under 60 characters')
});

export type AccountFormSchema = typeof accountFormSchema;
