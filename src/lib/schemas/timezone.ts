import { z } from 'zod';
import { canonicalizeTimeZone } from '$lib/timezone';

export const INVALID_TIMEZONE_MESSAGE = 'Use a valid timezone like Europe/London';

export const timezoneField = z
	.string()
	.trim()
	.min(1, 'Please enter a timezone')
	.transform((value, ctx) => {
		const timezone = canonicalizeTimeZone(value);
		if (!timezone) {
			ctx.addIssue({ code: 'custom', message: INVALID_TIMEZONE_MESSAGE });
			return z.NEVER;
		}

		return timezone;
	});
