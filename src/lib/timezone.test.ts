import { describe, expect, test } from 'vitest';
import {
	canonicalizeTimeZone,
	describeTimeZoneDifference,
	formatDateTimeInTimeZoneForViewer,
	humanizeTimeZone,
	searchTimeZones,
	timezoneBannerStorageKey
} from './timezone';

describe('canonicalizeTimeZone', () => {
	test('accepts a valid IANA timezone', () => {
		expect(canonicalizeTimeZone('Europe/London')).toBe('Europe/London');
	});

	test('rejects an invalid timezone', () => {
		expect(canonicalizeTimeZone('Mars/Base')).toBeNull();
	});
});

test('scopes the timezone banner key to one user', () => {
	expect(timezoneBannerStorageKey('u1')).toBe('bound-up:timezone-banner:u1');
});

test('humanizes the final timezone segment for compact UI copy', () => {
	expect(humanizeTimeZone('America/New_York')).toBe('New York');
});

test('describes timezone differences in hours and minutes', () => {
	const date = new Date('2026-01-15T12:00:00Z');
	expect(describeTimeZoneDifference('America/New_York', 'Europe/London', date)).toBe(
		'5 hours behind you'
	);
	expect(describeTimeZoneDifference('Asia/Kathmandu', 'UTC', date)).toBe(
		'5 hours 45 minutes ahead of you'
	);
});

test('shows only the time when both timezones are on the same calendar day', () => {
	const date = new Date('2026-01-15T12:00:00Z');
	expect(formatDateTimeInTimeZoneForViewer('America/New_York', 'Europe/London', date)).toBe(
		new Intl.DateTimeFormat(undefined, { timeStyle: 'short', timeZone: 'America/New_York' }).format(
			date
		)
	);
});

test('adds the date before the time when the viewer and partner are on different calendar days', () => {
	const date = new Date('2026-01-15T23:30:00Z');
	const dateText = new Intl.DateTimeFormat(undefined, {
		dateStyle: 'medium',
		timeZone: 'Asia/Tokyo'
	}).format(date);
	const timeText = new Intl.DateTimeFormat(undefined, {
		timeStyle: 'short',
		timeZone: 'Asia/Tokyo'
	}).format(date);

	expect(formatDateTimeInTimeZoneForViewer('Asia/Tokyo', 'Europe/London', date)).toBe(
		`${dateText} ${timeText}`
	);
});

test('matches a country name to its timezones', () => {
	const results = searchTimeZones('New Zealand', 5);
	expect(results[0]).toBe('Pacific/Auckland');
	expect(results).toContain('Pacific/Chatham');
});

test('prefers an exact timezone code match over looser matches', () => {
	const results = searchTimeZones('America/New_York', 5);
	expect(results[0]).toBe('America/New_York');
});
