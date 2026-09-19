import { z } from 'zod';

const localDateTimeSchema = z
	.string()
	.trim()
	.regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Please choose a valid date and time');

const userIdSchema = z.string().trim().min(1, 'Malformed user id');
const repeatUnitSchema = z.enum(['minute', 'hour', 'day', 'week', 'month', 'year']);
const weekdaySchema = z.enum(['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su']);

export const taskEditorFormSchema = z
	.object({
		title: z.string().max(80, 'Please keep this to 80 characters or fewer'),
		/**
		 * The editor's own working copy of the description, which is a serialised
		 * rich-text document rather than prose. Its length is not the reader's
		 * length, so the 500-character limit is applied to the visible text by
		 * `richTextFieldSchema` when the form is submitted — checking the raw
		 * string here would refuse a two-sentence description.
		 */
		description: z.string(),
		active: z.boolean(),
		creditsAwarded: z.string(),
		completionMessagesText: z.string(),
		timezoneOwnerUserId: userIdSchema,
		scheduleMode: z.enum(['one-off', 'rolling-window', 'after-completion', 'scheduled']),
		rollingLimitEnabled: z.boolean(),
		rollingLimitCompletions: z.string(),
		rollingLimitEvery: z.string(),
		rollingLimitUnit: repeatUnitSchema,
		afterEvery: z.string(),
		afterUnit: repeatUnitSchema,
		scheduledAnchorLocal: z.string(),
		scheduledFrequency: z.enum(['day', 'week', 'month', 'year']),
		scheduledInterval: z.string(),
		scheduledWeekdays: z.array(weekdaySchema),
		scheduledMonthlyPatternKind: z.enum(['day-of-month', 'nth-weekday']),
		scheduledDayOfMonth: z.string(),
		scheduledOrdinal: z.enum(['1', '2', '3', '4', '-1']),
		scheduledWeekday: weekdaySchema,
		scheduledEndKind: z.enum(['never', 'until', 'count']),
		scheduledUntilLocal: z.string(),
		scheduledCount: z.string()
	})
	.superRefine((data, ctx) => {
		if (data.title.trim().length === 0) {
			ctx.addIssue({ code: 'custom', path: ['title'], message: 'Please enter a task title' });
		}

		if (!/^\d+$/.test(data.creditsAwarded) || Number(data.creditsAwarded) < 0) {
			ctx.addIssue({
				code: 'custom',
				path: ['creditsAwarded'],
				message: /^\d+$/.test(data.creditsAwarded)
					? 'Credits cannot be negative'
					: 'Please enter a whole number'
			});
		}

		const completionMessages = data.completionMessagesText
			.split(/\r?\n/)
			.map((value) => value.trim())
			.filter((value) => value.length > 0);
		if (completionMessages.length > 20) {
			ctx.addIssue({
				code: 'custom',
				path: ['completionMessagesText'],
				message: 'Please keep this to 20 completion messages or fewer'
			});
		}

		if (data.scheduleMode === 'rolling-window' && data.rollingLimitEnabled) {
			if (!/^\d+$/.test(data.rollingLimitCompletions) || Number(data.rollingLimitCompletions) < 1) {
				ctx.addIssue({
					code: 'custom',
					path: ['rollingLimitCompletions'],
					message: 'Please enter at least 1'
				});
			}
			if (!/^\d+$/.test(data.rollingLimitEvery) || Number(data.rollingLimitEvery) < 1) {
				ctx.addIssue({
					code: 'custom',
					path: ['rollingLimitEvery'],
					message: 'Please enter at least 1'
				});
			}
		}

		if (data.scheduleMode === 'after-completion') {
			if (!/^\d+$/.test(data.afterEvery) || Number(data.afterEvery) < 1) {
				ctx.addIssue({
					code: 'custom',
					path: ['afterEvery'],
					message: 'Please enter at least 1'
				});
			}
		}

		if (data.scheduleMode === 'scheduled') {
			if (!localDateTimeSchema.safeParse(data.scheduledAnchorLocal).success) {
				ctx.addIssue({
					code: 'custom',
					path: ['scheduledAnchorLocal'],
					message: 'Please choose a valid date and time'
				});
			}
			if (!/^\d+$/.test(data.scheduledInterval) || Number(data.scheduledInterval) < 1) {
				ctx.addIssue({
					code: 'custom',
					path: ['scheduledInterval'],
					message: 'Please enter at least 1'
				});
			}
			if (data.scheduledFrequency === 'week' && data.scheduledWeekdays.length === 0) {
				ctx.addIssue({
					code: 'custom',
					path: ['scheduledWeekdays'],
					message: 'Choose at least one day'
				});
			}
			if (
				data.scheduledFrequency === 'month' &&
				data.scheduledMonthlyPatternKind === 'day-of-month' &&
				(!/^\d+$/.test(data.scheduledDayOfMonth) ||
					Number(data.scheduledDayOfMonth) < 1 ||
					Number(data.scheduledDayOfMonth) > 31)
			) {
				ctx.addIssue({
					code: 'custom',
					path: ['scheduledDayOfMonth'],
					message: 'Please enter a day between 1 and 31'
				});
			}
			if (
				data.scheduledEndKind === 'until' &&
				!localDateTimeSchema.safeParse(data.scheduledUntilLocal).success
			) {
				ctx.addIssue({
					code: 'custom',
					path: ['scheduledUntilLocal'],
					message: 'Please choose a valid date and time'
				});
			}
			if (
				data.scheduledEndKind === 'count' &&
				(!/^\d+$/.test(data.scheduledCount) || Number(data.scheduledCount) < 1)
			) {
				ctx.addIssue({
					code: 'custom',
					path: ['scheduledCount'],
					message: 'Please enter at least 1'
				});
			}
		}
	});

export type TaskEditorFormSchema = typeof taskEditorFormSchema;
