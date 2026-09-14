import { render, screen } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { PageData } from './$types';

const pageState = {
	data: {
		user: {
			id: 'u1',
			name: 'Ada',
			email: 'ada@example.com',
			image: null,
			timezone: 'Europe/London'
		}
	}
};

vi.mock('$app/state', () => ({
	get page() {
		return pageState;
	}
}));

vi.mock('$app/paths', () => ({
	resolve: (id: string, params?: Record<string, string>) =>
		params ? id.replace(/\[(\w+)\]/g, (_, key) => params[key]) : id
}));

const { default: Page } = await import('./+page.svelte');

function data(timezone: string | null): PageData {
	return {
		partner: {
			id: 'p1',
			name: 'Jun',
			yourName: 'Ada',
			image: null,
			timezone,
			partnerRole: 'sub',
			yourRole: 'dom',
			canEdit: true
		}
	} as PageData;
}

describe('/partner/[id]/+page.svelte', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	test("shows the partner role as the current user's name plus role", () => {
		render(Page, { data: data('America/New_York') });
		expect(screen.getByText("Ada's sub")).toBeInTheDocument();
		expect(screen.queryByText(/dom \/ sub|sub \/ dom/)).not.toBeInTheDocument();
	});

	test('shows partner local time when their timezone differs from the viewer', () => {
		render(Page, { data: data('America/New_York') });

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

	test('shows the date before the time when their local day differs from the viewer', () => {
		vi.setSystemTime(new Date('2026-01-15T23:30:00Z'));
		render(Page, { data: data('Asia/Tokyo') });

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

	test('hides partner local time when both accounts share the same timezone', () => {
		render(Page, { data: data('Europe/London') });
		expect(screen.queryByText(/time - /)).not.toBeInTheDocument();
	});
});
