import { render, screen } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { default: TimeZoneDisplay } = await import('./TimeZoneDisplay.svelte');

describe('TimeZoneDisplay', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	test('shows the partner-page format when the current time is included', () => {
		render(TimeZoneDisplay, {
			timeZone: 'America/New_York',
			referenceTimeZone: 'Europe/London',
			showCurrentTime: true
		});

		const localTime = new Intl.DateTimeFormat(undefined, {
			timeStyle: 'short',
			timeZone: 'America/New_York'
		}).format(new Date('2026-01-15T12:00:00Z'));

		expect(
			screen.getByText(
				new RegExp(`${localTime.replace(':', '\\:')} New York time \\(5 hours behind you\\)`)
			)
		).toBeInTheDocument();
	});

	test('shows the task-style format when the current time is omitted', () => {
		render(TimeZoneDisplay, {
			timeZone: 'America/New_York',
			referenceTimeZone: 'Europe/London'
		});

		expect(screen.getByText('New York time (5 hours behind you)')).toBeInTheDocument();
	});

	test('shows the date before the time when the local day differs from the viewer', () => {
		vi.setSystemTime(new Date('2026-01-15T23:30:00Z'));

		render(TimeZoneDisplay, {
			timeZone: 'Asia/Tokyo',
			referenceTimeZone: 'Europe/London',
			showCurrentTime: true
		});

		const dateText = new Intl.DateTimeFormat(undefined, {
			dateStyle: 'medium',
			timeZone: 'Asia/Tokyo'
		}).format(new Date('2026-01-15T23:30:00Z'));
		const timeText = new Intl.DateTimeFormat(undefined, {
			timeStyle: 'short',
			timeZone: 'Asia/Tokyo'
		}).format(new Date('2026-01-15T23:30:00Z'));

		expect(
			screen.getByText(
				new RegExp(
					`${dateText.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')} ${timeText.replace(':', '\\:')} Tokyo time \\(9 hours ahead of you\\)`
				)
			)
		).toBeInTheDocument();
	});

	test('renders nothing when both timezones are the same', () => {
		const { container } = render(TimeZoneDisplay, {
			timeZone: 'Europe/London',
			referenceTimeZone: 'Europe/London',
			showCurrentTime: true
		});

		expect(container.textContent).toBe('');
	});
});
