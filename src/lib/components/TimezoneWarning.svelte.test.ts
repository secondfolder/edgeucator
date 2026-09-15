import { fireEvent, render, screen } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

let deviceTimezone = 'America/New_York';
const invalidateAll = vi.fn().mockResolvedValue(undefined);

vi.mock('$app/navigation', () => ({ invalidateAll }));
vi.mock('$lib/timezone', () => ({
	currentTimeZoneOrUtc: () => deviceTimezone,
	timezoneBannerStorageKey: (userId: string) => `bound-up:timezone-banner:${userId}`
}));

const { default: TimezoneWarning } = await import('./TimezoneWarning.svelte');

const user = { id: 'u1', timezone: 'Europe/London' };

function fakeStorage() {
	const values = new Map<string, string>();
	return {
		clear: () => values.clear(),
		getItem: (key: string) => values.get(key) ?? null,
		key: (index: number) => [...values.keys()][index] ?? null,
		removeItem: (key: string) => values.delete(key),
		setItem: (key: string, value: string) => values.set(key, value),
		get length() {
			return values.size;
		}
	} satisfies Storage;
}

beforeEach(() => {
	deviceTimezone = 'America/New_York';
	Object.defineProperty(window, 'localStorage', {
		configurable: true,
		value: fakeStorage()
	});
	invalidateAll.mockClear();
	vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('TimezoneWarning', () => {
	test('shows when the device timezone differs from the account timezone', () => {
		render(TimezoneWarning, { user });
		expect(screen.getByText('This device is in a different timezone')).toBeInTheDocument();
		expect(screen.getByText(/this device is set to America\/New_York/i)).toBeInTheDocument();
	});

	test('stays hidden when the device timezone matches', () => {
		deviceTimezone = 'Europe/London';
		render(TimezoneWarning, { user: { ...user, timezone: 'Europe/London' } });
		expect(screen.queryByText('This device is in a different timezone')).not.toBeInTheDocument();
	});

	test('dismisses and caches the dismissal for the current device timezone', async () => {
		const { container } = render(TimezoneWarning, { user });
		const dismiss = container.querySelectorAll('wa-button')[1];
		if (!(dismiss instanceof HTMLElement)) throw new Error('missing dismiss button');
		await fireEvent.click(dismiss);

		expect(window.localStorage.getItem('bound-up:timezone-banner:u1')).toBe('America/New_York');
		expect(screen.queryByText('This device is in a different timezone')).not.toBeInTheDocument();
	});

	test('honours a cached dismissal only for the same device timezone', () => {
		window.localStorage.setItem('bound-up:timezone-banner:u1', 'America/New_York');
		const first = render(TimezoneWarning, { user });
		expect(screen.queryByText('This device is in a different timezone')).not.toBeInTheDocument();

		first.unmount();
		deviceTimezone = 'Asia/Tokyo';
		render(TimezoneWarning, { user });
		expect(screen.getByText('This device is in a different timezone')).toBeInTheDocument();
	});
});
