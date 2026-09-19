import { z } from 'zod';
import { richTextFieldSchema } from '$lib/schemas/richTextField';

const titleSchema = z
	.string()
	.trim()
	.min(1, 'Please enter a task title')
	.max(80, 'Please keep this to 80 characters or fewer');

/** Rich text: the 500 is characters of prose, not bytes of document. */
const descriptionSchema = richTextFieldSchema(500);

const creditsSchema = z.coerce
	.number()
	.int('Please enter a whole number')
	.min(0, 'Credits cannot be negative');

const positiveIntSchema = z.coerce
	.number()
	.int('Please enter a whole number')
	.min(1, 'Please enter at least 1');

const localDateTimeSchema = z
	.string()
	.trim()
	.regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Please choose a valid date and time');

const taskIdSchema = z.string().uuid('Malformed task id');
const partnershipIdSchema = z.string().uuid('Malformed partnership id');
const userIdSchema = z.string().trim().min(1, 'Malformed user id');

const repeatUnitSchema = z.enum(['minute', 'hour', 'day', 'week', 'month', 'year']);
const weekdaySchema = z.enum(['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su']);

const monthlyPatternSchema = z.discriminatedUnion('kind', [
	z.object({
		kind: z.literal('day-of-month'),
		day: z.coerce.number().int('Please enter a whole number').min(1).max(31)
	}),
	z.object({
		kind: z.literal('nth-weekday'),
		ordinal: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(-1)]),
		weekday: weekdaySchema
	})
]);

const scheduleEndSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('never') }),
	z.object({ kind: z.literal('until'), untilLocal: localDateTimeSchema }),
	z.object({ kind: z.literal('count'), count: positiveIntSchema })
]);

export const taskScheduleSchema = z.discriminatedUnion('mode', [
	z.object({ mode: z.literal('one-off') }),
	z.object({
		mode: z.literal('rolling-window'),
		limit: z
			.object({
				completions: positiveIntSchema,
				every: positiveIntSchema,
				unit: repeatUnitSchema
			})
			.nullable()
	}),
	z.object({
		mode: z.literal('after-completion'),
		every: positiveIntSchema,
		unit: repeatUnitSchema
	}),
	z.object({
		mode: z.literal('scheduled'),
		anchorLocal: localDateTimeSchema,
		frequency: z.enum(['day', 'week', 'month', 'year']),
		interval: positiveIntSchema,
		weekdays: z.array(weekdaySchema).optional(),
		monthlyPattern: monthlyPatternSchema.optional(),
		end: scheduleEndSchema
	})
]);

export const taskFormSchema = z.object({
	title: titleSchema,
	description: descriptionSchema,
	active: z.boolean(),
	creditsAwarded: creditsSchema,
	completionMessages: z
		.array(z.string().trim().min(1, 'Completion messages cannot be empty'))
		.max(20, 'Please keep this to 20 completion messages or fewer'),
	timezoneOwnerUserId: userIdSchema,
	schedule: taskScheduleSchema
});

export const taskCompleteSchema = z.object({ taskId: taskIdSchema });

export const partnerTaskCompleteSchema = taskCompleteSchema.extend({
	partnershipId: partnershipIdSchema
});

export const taskUpdateSchema = taskFormSchema.extend({ taskId: taskIdSchema });
