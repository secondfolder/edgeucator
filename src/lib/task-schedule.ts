import { Temporal } from '@js-temporal/polyfill';
import type {
	TaskMonthlyPattern,
	TaskRepeatUnit,
	TaskSchedule,
	TaskScheduleEnd,
	TaskWeekday
} from './types';

const weekdayNumbers: Record<TaskWeekday, number> = {
	mo: 1,
	tu: 2,
	we: 3,
	th: 4,
	fr: 5,
	sa: 6,
	su: 7
};

const weekdayCodes = {
	1: 'mo',
	2: 'tu',
	3: 'we',
	4: 'th',
	5: 'fr',
	6: 'sa',
	7: 'su'
} as const;

type LocalDateTime = Temporal.PlainDateTime;

function fromLocalIso(localIso: string): LocalDateTime | null {
	try {
		return Temporal.PlainDateTime.from(localIso);
	} catch {
		return null;
	}
}

function toInstantDate(localDateTime: LocalDateTime, timeZone: string): Date | null {
	try {
		return new Date(localDateTime.toZonedDateTime(timeZone).epochMilliseconds);
	} catch {
		return null;
	}
}

export function resolveTaskLocalDateTime(localIso: string, timeZone: string): Date | null {
	const localDateTime = fromLocalIso(localIso);
	if (!localDateTime) return null;
	return toInstantDate(localDateTime, timeZone);
}

export function taskLocalDateTimeInputValue(date: Date, timeZone: string): string {
	const zoned = Temporal.Instant.fromEpochMilliseconds(date.getTime()).toZonedDateTimeISO(timeZone);
	const pad = (value: number) => String(value).padStart(2, '0');
	return `${zoned.year}-${pad(zoned.month)}-${pad(zoned.day)}T${pad(zoned.hour)}:${pad(zoned.minute)}`;
}

export function addTaskDuration(
	date: Date,
	every: number,
	unit: TaskRepeatUnit,
	timeZone: string
): Date {
	const zoned = Temporal.Instant.fromEpochMilliseconds(date.getTime()).toZonedDateTimeISO(timeZone);
	switch (unit) {
		case 'minute':
			return new Date(zoned.add({ minutes: every }).epochMilliseconds);
		case 'hour':
			return new Date(zoned.add({ hours: every }).epochMilliseconds);
		case 'day':
			return new Date(zoned.add({ days: every }).epochMilliseconds);
		case 'week':
			return new Date(zoned.add({ weeks: every }).epochMilliseconds);
		case 'month':
			return new Date(zoned.add({ months: every }).epochMilliseconds);
		case 'year':
			return new Date(zoned.add({ years: every }).epochMilliseconds);
	}
}

function monthlyCandidate(
	monthStart: LocalDateTime,
	pattern: TaskMonthlyPattern | undefined,
	anchor: LocalDateTime
): LocalDateTime {
	const daysInMonth = Temporal.PlainYearMonth.from({
		year: monthStart.year,
		month: monthStart.month
	}).daysInMonth;

	if (!pattern || pattern.kind === 'day-of-month') {
		const day = pattern?.kind === 'day-of-month' ? pattern.day : anchor.day;
		return monthStart.with({
			day: Math.min(day, daysInMonth),
			hour: anchor.hour,
			minute: anchor.minute,
			second: 0,
			millisecond: 0,
			microsecond: 0,
			nanosecond: 0
		});
	}

	const weekday = weekdayNumbers[pattern.weekday];
	if (pattern.ordinal === -1) {
		let candidate = monthStart.with({
			day: daysInMonth,
			hour: anchor.hour,
			minute: anchor.minute,
			second: 0,
			millisecond: 0,
			microsecond: 0,
			nanosecond: 0
		});
		while (candidate.dayOfWeek !== weekday) candidate = candidate.subtract({ days: 1 });
		return candidate;
	}

	let candidate = monthStart.with({
		day: 1,
		hour: anchor.hour,
		minute: anchor.minute,
		second: 0,
		millisecond: 0,
		microsecond: 0,
		nanosecond: 0
	});
	while (candidate.dayOfWeek !== weekday) candidate = candidate.add({ days: 1 });
	return candidate.add({ weeks: pattern.ordinal - 1 });
}

function scheduleEndDate(end: TaskScheduleEnd): LocalDateTime | null {
	if (end.kind !== 'until') return null;
	return fromLocalIso(end.untilLocal);
}

function compareLocalDateTime(left: LocalDateTime, right: LocalDateTime): number {
	return Temporal.PlainDateTime.compare(left, right);
}

function weekStartOf(anchor: LocalDateTime): LocalDateTime {
	return anchor.subtract({ days: anchor.dayOfWeek - 1 });
}

function toOccurrenceDate(localDateTime: LocalDateTime, timeZone: string): Date | null {
	return toInstantDate(localDateTime, timeZone);
}

function* scheduledOccurrences(
	schedule: Extract<TaskSchedule, { mode: 'scheduled' }>,
	timeZone: string
): Generator<Date> {
	const anchor = fromLocalIso(schedule.anchorLocal);
	if (!anchor) return;

	const until = scheduleEndDate(schedule.end);
	const selectedWeekdays =
		schedule.weekdays && schedule.weekdays.length > 0
			? [...schedule.weekdays].sort((left, right) => weekdayNumbers[left] - weekdayNumbers[right])
			: [weekdayCodes[anchor.dayOfWeek as keyof typeof weekdayCodes]];

	let emitted = 0;

	for (let step = 0; step < 5000; step += 1) {
		const candidates: LocalDateTime[] = [];

		switch (schedule.frequency) {
			case 'day':
				candidates.push(anchor.add({ days: step * schedule.interval }));
				break;
			case 'week': {
				const weekStart = weekStartOf(anchor).add({ weeks: step * schedule.interval });
				for (const weekday of selectedWeekdays) {
					const candidate = weekStart.add({ days: weekdayNumbers[weekday] - 1 }).with({
						hour: anchor.hour,
						minute: anchor.minute,
						second: 0,
						millisecond: 0,
						microsecond: 0,
						nanosecond: 0
					});
					candidates.push(candidate);
				}
				break;
			}
			case 'month': {
				const monthStart = anchor
					.add({ months: step * schedule.interval })
					.with({ day: 1, second: 0, millisecond: 0, microsecond: 0, nanosecond: 0 });
				candidates.push(monthlyCandidate(monthStart, schedule.monthlyPattern, anchor));
				break;
			}
			case 'year':
				candidates.push(anchor.add({ years: step * schedule.interval }));
				break;
		}

		for (const candidate of candidates.sort(compareLocalDateTime)) {
			if (compareLocalDateTime(candidate, anchor) < 0) continue;
			if (until && compareLocalDateTime(candidate, until) > 0) return;
			const occurrence = toOccurrenceDate(candidate, timeZone);
			if (!occurrence) continue;
			emitted += 1;
			yield occurrence;
			if (schedule.end.kind === 'count' && emitted >= schedule.end.count) return;
		}
	}
}

export function scheduledCurrentOrNextOccurrence(
	schedule: Extract<TaskSchedule, { mode: 'scheduled' }>,
	timeZone: string,
	now: Date = new Date()
): Date | null {
	let last: Date | null = null;

	for (const occurrence of scheduledOccurrences(schedule, timeZone)) {
		if (occurrence.getTime() <= now.getTime()) {
			last = occurrence;
			continue;
		}
		return last ?? occurrence;
	}

	return last;
}

export function nextScheduledOccurrenceAfter(
	schedule: Extract<TaskSchedule, { mode: 'scheduled' }>,
	timeZone: string,
	after: Date
): Date | null {
	for (const occurrence of scheduledOccurrences(schedule, timeZone)) {
		if (occurrence.getTime() > after.getTime()) return occurrence;
	}
	return null;
}

export function initialNextEligibleAt(
	schedule: TaskSchedule,
	timeZone: string,
	now: Date = new Date()
): Date | null {
	if (schedule.mode !== 'scheduled') return null;
	return scheduledCurrentOrNextOccurrence(schedule, timeZone, now);
}

export function nextEligibleAtAfterCompletion(
	schedule: TaskSchedule,
	timeZone: string,
	completedAt: Date,
	recentCompletionTimes: Date[] = []
): Date | null {
	switch (schedule.mode) {
		case 'one-off':
			return null;
		case 'rolling-window': {
			if (!schedule.limit) return null;
			const allTimes = [...recentCompletionTimes, completedAt].sort(
				(left, right) => left.getTime() - right.getTime()
			);
			if (allTimes.length < schedule.limit.completions) return null;
			const gateSource = allTimes[allTimes.length - schedule.limit.completions];
			const gate = addTaskDuration(gateSource, schedule.limit.every, schedule.limit.unit, timeZone);
			return gate.getTime() > completedAt.getTime() ? gate : null;
		}
		case 'after-completion':
			return addTaskDuration(completedAt, schedule.every, schedule.unit, timeZone);
		case 'scheduled':
			return nextScheduledOccurrenceAfter(schedule, timeZone, completedAt);
	}
}

export function describeTaskSchedule(schedule: TaskSchedule): string {
	switch (schedule.mode) {
		case 'one-off':
			return 'One-off';
		case 'rolling-window':
			return schedule.limit
				? `Repeat anytime, up to ${schedule.limit.completions} time${schedule.limit.completions === 1 ? '' : 's'} per ${schedule.limit.every} ${schedule.limit.unit}${schedule.limit.every === 1 ? '' : 's'}`
				: 'Repeat anytime';
		case 'after-completion':
			return `Repeats ${schedule.every} ${schedule.unit}${schedule.every === 1 ? '' : 's'} after completion`;
		case 'scheduled':
			return `Scheduled every ${schedule.interval} ${schedule.frequency}${schedule.interval === 1 ? '' : 's'}`;
	}
}

export function scheduleReferenceDate(schedule: TaskSchedule, timeZone: string): Date | null {
	if (schedule.mode !== 'scheduled') return null;
	return resolveTaskLocalDateTime(schedule.anchorLocal, timeZone);
}
