import { z } from 'zod';
import { timezoneField } from './timezone';

export const accountFormSchema = z.object({
	name: z
		.string()
		.trim()
		.min(1, 'Please enter a name')
		.max(60, 'Keep your name under 60 characters'),
	timezone: timezoneField
});

export type AccountFormSchema = typeof accountFormSchema;
