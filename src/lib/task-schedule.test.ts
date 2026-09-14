import { describe, expect, test } from 'vitest';
import {
	addTaskDuration,
	describeTaskSchedule,
	initialNextEligibleAt,
	nextEligibleAtAfterCompletion,
	resolveTaskLocalDateTime,
	scheduledCurrentOrNextOccurrence,
	taskLocalDateTimeInputValue
} from './task-schedule';

describe('resolveTaskLocalDateTime', () => {
	test('converts a local datetime in the owner timezone to UTC', () => {
		expect(resolveTaskLocalDateTime('2026-01-15T09:30', 'America/New_York')?.toISOString()).toBe(
			'2026-01-15T14:30:00.000Z'
		);
	});
});

describe('taskLocalDateTimeInputValue', () => {
	test('converts a UTC instant back into a local datetime input value', () => {
		expect(
			taskLocalDateTimeInputValue(new Date('2026-01-15T14:30:00.000Z'), 'America/New_York')
		).toBe('2026-01-15T09:30');
	});
});

describe('addTaskDuration', () => {
	test('adds month-based durations in the owner timezone', () => {
		expect(
			addTaskDuration(new Date('2026-01-31T15:00:00.000Z'), 1, 'month', 'UTC').toISOString()
		).toBe('2026-02-28T15:00:00.000Z');
	});
});

describe('scheduledCurrentOrNextOccurrence', () => {
	test('returns the current due occurrence when a scheduled task is already due', () => {
		const occurrence = scheduledCurrentOrNextOccurrence(
			{
				mode: 'scheduled',
				anchorLocal: '2026-09-14T09:00',
				frequency: 'day',
				interval: 1,
				end: { kind: 'never' }
			},
			'Europe/London',
			new Date('2026-09-14T12:00:00.000Z')
		);

		expect(occurrence?.toISOString()).toBe('2026-09-14T08:00:00.000Z');
	});

	test('returns the next monthly nth-weekday occurrence', () => {
		const occurrence = scheduledCurrentOrNextOccurrence(
			{
				mode: 'scheduled',
				anchorLocal: '2026-09-01T10:00',
				frequency: 'month',
				interval: 1,
				monthlyPattern: { kind: 'nth-weekday', ordinal: 2, weekday: 'tu' },
				end: { kind: 'never' }
			},
			'Europe/London',
			new Date('2026-09-05T12:00:00.000Z')
		);

		expect(occurrence?.toISOString()).toBe('2026-09-08T09:00:00.000Z');
	});
});

describe('initialNextEligibleAt', () => {
	test('is null for unscheduled tasks', () => {
		expect(initialNextEligibleAt({ mode: 'one-off' }, 'UTC')).toBeNull();
	});
});

describe('nextEligibleAtAfterCompletion', () => {
	test('locks an after-completion task until the interval elapses', () => {
		expect(
			nextEligibleAtAfterCompletion(
				{ mode: 'after-completion', every: 2, unit: 'day' },
				'Europe/London',
				new Date('2026-09-14T12:00:00.000Z')
			)?.toISOString()
		).toBe('2026-09-16T12:00:00.000Z');
	});

	test('uses the rolling window limit to compute the next available time', () => {
		expect(
			nextEligibleAtAfterCompletion(
				{
					mode: 'rolling-window',
					limit: { completions: 2, every: 1, unit: 'day' }
				},
				'UTC',
				new Date('2026-09-14T12:00:00.000Z'),
				[new Date('2026-09-14T09:00:00.000Z')]
			)?.toISOString()
		).toBe('2026-09-15T09:00:00.000Z');
	});

	test('advances a scheduled task to the next future occurrence after completion', () => {
		expect(
			nextEligibleAtAfterCompletion(
				{
					mode: 'scheduled',
					anchorLocal: '2026-09-14T09:00',
					frequency: 'week',
					interval: 1,
					weekdays: ['mo'],
					end: { kind: 'never' }
				},
				'Europe/London',
				new Date('2026-09-14T12:00:00.000Z')
			)?.toISOString()
		).toBe('2026-09-21T08:00:00.000Z');
	});
});

describe('describeTaskSchedule', () => {
	test('describes the main user-facing modes', () => {
		expect(describeTaskSchedule({ mode: 'one-off' })).toBe('One-off');
		expect(describeTaskSchedule({ mode: 'after-completion', every: 3, unit: 'week' })).toBe(
			'Repeats 3 weeks after completion'
		);
	});
});
