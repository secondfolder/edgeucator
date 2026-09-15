import { getAllCountries, getTimezone } from 'countries-and-timezones';

export const UTC_TIMEZONE = 'UTC';

export function canonicalizeTimeZone(value: string): string | null {
	const candidate = value.trim();
	if (candidate.length === 0) return null;

	try {
		return new Intl.DateTimeFormat('en-US', { timeZone: candidate }).resolvedOptions().timeZone;
	} catch {
		return null;
	}
}

export function currentTimeZoneOrUtc(): string {
	return (
		canonicalizeTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone ?? '') ?? UTC_TIMEZONE
	);
}

export function humanizeTimeZone(timeZone: string): string {
	if (timeZone === UTC_TIMEZONE) return UTC_TIMEZONE;

	const pieces = timeZone.split('/');
	return (pieces[pieces.length - 1] ?? timeZone).replace(/_/g, ' ');
}

function offsetMinutesForTimeZone(timeZone: string, date: Date): number {
	const part = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hour: '2-digit',
		timeZoneName: 'shortOffset'
	})
		.formatToParts(date)
		.find((value) => value.type === 'timeZoneName')?.value;

	if (!part || part === 'GMT') return 0;

	const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(part);
	if (!match) return 0;

	const [, sign, hours, minutes] = match;
	const total = Number(hours) * 60 + Number(minutes ?? '0');
	return sign === '+' ? total : -total;
}

export function describeTimeZoneDifference(
	timeZone: string,
	referenceTimeZone: string,
	date: Date = new Date()
): string {
	const diffMinutes =
		offsetMinutesForTimeZone(timeZone, date) - offsetMinutesForTimeZone(referenceTimeZone, date);
	if (diffMinutes === 0) return 'same time';

	const absolute = Math.abs(diffMinutes);
	const hours = Math.floor(absolute / 60);
	const minutes = absolute % 60;
	const parts: string[] = [];
	if (hours > 0) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
	if (minutes > 0) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);

	return `${parts.join(' ')} ${diffMinutes > 0 ? 'ahead of you' : 'behind you'}`;
}

export function formatTimeInTimeZone(timeZone: string, date: Date = new Date()): string {
	return new Intl.DateTimeFormat(undefined, { timeStyle: 'short', timeZone }).format(date);
}

function calendarDayKey(timeZone: string, date: Date): string {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(date);
}

export function formatDateTimeInTimeZoneForViewer(
	timeZone: string,
	referenceTimeZone: string,
	date: Date = new Date()
): string {
	if (calendarDayKey(timeZone, date) === calendarDayKey(referenceTimeZone, date)) {
		return formatTimeInTimeZone(timeZone, date);
	}

	const dateText = new Intl.DateTimeFormat(undefined, {
		dateStyle: 'medium',
		timeZone
	}).format(date);
	const timeText = formatTimeInTimeZone(timeZone, date);
	return `${dateText} ${timeText}`;
}

function normalizeSearchText(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim()
		.replace(/\s+/g, ' ');
}

const FALLBACK_TIMEZONES = [
	UTC_TIMEZONE,
	'America/Los_Angeles',
	'America/New_York',
	'Asia/Tokyo',
	'Australia/Sydney',
	'Europe/Berlin',
	'Europe/London'
] as const;

export function supportedTimeZones(): string[] {
	if (typeof Intl.supportedValuesOf !== 'function') return [...FALLBACK_TIMEZONES];

	const values = Intl.supportedValuesOf('timeZone');
	return [UTC_TIMEZONE, ...values.filter((timezone) => timezone !== UTC_TIMEZONE)];
}

type TimeZoneSearchEntry = {
	timezone: string;
	rawLower: string;
	normalizedTimezone: string;
	normalizedHumanName: string;
	normalizedCountryNames: string[];
};

let cachedTimeZoneSearchEntries: TimeZoneSearchEntry[] | null = null;

function timeZoneSearchEntries(): TimeZoneSearchEntry[] {
	if (cachedTimeZoneSearchEntries) return cachedTimeZoneSearchEntries;

	const countries = getAllCountries();
	cachedTimeZoneSearchEntries = supportedTimeZones().map((timezone) => {
		const metadata = getTimezone(timezone);
		const countryNames = [
			...new Set(
				(metadata?.countries ?? [])
					.map((countryCode) => countries[countryCode]?.name)
					.filter(Boolean)
			)
		] as string[];

		return {
			timezone,
			rawLower: timezone.toLowerCase(),
			normalizedTimezone: normalizeSearchText(timezone),
			normalizedHumanName: normalizeSearchText(humanizeTimeZone(timezone)),
			normalizedCountryNames: countryNames.map(normalizeSearchText)
		};
	});

	return cachedTimeZoneSearchEntries;
}

function scoreTimeZoneSearch(
	entry: TimeZoneSearchEntry,
	rawQuery: string,
	normalizedQuery: string
): number | null {
	if (rawQuery === entry.rawLower || normalizedQuery === entry.normalizedTimezone) return 0;
	if (normalizedQuery === entry.normalizedHumanName) return 1;
	if (entry.normalizedCountryNames.includes(normalizedQuery)) return 2;

	if (
		entry.rawLower.startsWith(rawQuery) ||
		entry.normalizedTimezone.startsWith(normalizedQuery) ||
		entry.normalizedHumanName.startsWith(normalizedQuery)
	) {
		return 3;
	}

	if (entry.normalizedCountryNames.some((countryName) => countryName.startsWith(normalizedQuery))) {
		return 4;
	}

	if (
		entry.rawLower.includes(rawQuery) ||
		entry.normalizedTimezone.includes(normalizedQuery) ||
		entry.normalizedHumanName.includes(normalizedQuery)
	) {
		return 5;
	}

	if (entry.normalizedCountryNames.some((countryName) => countryName.includes(normalizedQuery))) {
		return 6;
	}

	return null;
}

export function searchTimeZones(query: string, limit = supportedTimeZones().length): string[] {
	const trimmedQuery = query.trim();
	if (trimmedQuery.length === 0) return supportedTimeZones().slice(0, limit);

	const rawQuery = trimmedQuery.toLowerCase();
	const normalizedQuery = normalizeSearchText(trimmedQuery);

	return timeZoneSearchEntries()
		.map((entry) => ({ entry, score: scoreTimeZoneSearch(entry, rawQuery, normalizedQuery) }))
		.filter(
			(result): result is { entry: TimeZoneSearchEntry; score: number } => result.score !== null
		)
		.sort(
			(left, right) =>
				left.score - right.score || left.entry.timezone.localeCompare(right.entry.timezone)
		)
		.slice(0, limit)
		.map(({ entry }) => entry.timezone);
}

export function timezoneBannerStorageKey(userId: string): string {
	return `bound-up:timezone-banner:${userId}`;
}
