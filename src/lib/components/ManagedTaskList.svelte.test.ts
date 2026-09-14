import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';
import { describe, expect, test } from 'vitest';
import type { PartnershipTaskView, SelfTaskView } from '$lib/types';

const { default: ManagedTaskList } = await import('./ManagedTaskList.svelte');

function task(overrides: Partial<SelfTaskView> = {}): SelfTaskView {
	const now = new Date('2026-09-14T10:00:00Z');

	return {
		id: 'task-1',
		title: 'Stretch',
		description: null,
		active: true,
		creditsAwarded: 3,
		completionMessages: [],
		schedule: { mode: 'one-off' },
		timezoneOwnerUserId: 'u1',
		lastCompletedAt: null,
		completedCount: 0,
		nextEligibleAt: null,
		canComplete: true,
		createdAt: now,
		updatedAt: now,
		timeZoneNote: null,
		...overrides
	};
}

function partnershipTask(overrides: Partial<PartnershipTaskView> = {}): PartnershipTaskView {
	const now = new Date('2026-09-14T10:00:00Z');

	return {
		id: 'partnership-task-1',
		title: 'Bring coffee',
		description: null,
		active: true,
		creditsAwarded: 3,
		completionMessages: [],
		schedule: { mode: 'one-off' },
		timezoneOwnerUserId: 'u2',
		lastCompletedAt: null,
		completedCount: 0,
		nextEligibleAt: null,
		createdByMe: true,
		canManage: true,
		canComplete: false,
		createdAt: now,
		updatedAt: now,
		timeZoneNote: null,
		...overrides
	};
}

describe('ManagedTaskList', () => {
	test('shows a plus sign for multi-credit task rewards', () => {
		render(ManagedTaskList, {
			tasks: [task({ creditsAwarded: 3 })],
			emptyMessage: 'No tasks'
		});

		expect(screen.getByText('+3 credits')).toBeInTheDocument();
	});

	test('shows a plus sign for single-credit task rewards', () => {
		render(ManagedTaskList, {
			tasks: [task({ id: 'task-2', creditsAwarded: 1 })],
			emptyMessage: 'No tasks'
		});

		expect(screen.getByText('+1 credit')).toBeInTheDocument();
	});

	test('omits the credit label for zero-credit tasks', () => {
		render(ManagedTaskList, {
			tasks: [task({ id: 'task-3', creditsAwarded: 0 })],
			emptyMessage: 'No tasks'
		});

		expect(screen.queryByText('+0 credits')).not.toBeInTheDocument();
		expect(screen.queryByText('+0 credit')).not.toBeInTheDocument();
	});

	test('omits the generic unavailable copy for partnership tasks created by the current user', () => {
		render(ManagedTaskList, {
			tasks: [partnershipTask()],
			emptyMessage: 'No tasks'
		});

		expect(screen.queryByText('Not available right now')).not.toBeInTheDocument();
		expect(screen.queryByText('Created by you')).not.toBeInTheDocument();
	});

	test('does not show ready-to-complete or authorship helper text', () => {
		render(ManagedTaskList, {
			tasks: [partnershipTask({ createdByMe: false, canComplete: true })],
			emptyMessage: 'No tasks'
		});

		expect(screen.queryByText('Created by your partner')).not.toBeInTheDocument();
		expect(screen.queryByText('Ready to complete')).not.toBeInTheDocument();
	});

	test('does not render an edit button for partnership tasks created by the other partner', () => {
		const { container } = render(ManagedTaskList, {
			tasks: [partnershipTask({ createdByMe: false, canManage: true, canComplete: true })],
			emptyMessage: 'No tasks',
			editHref: (taskId: string) => `/tasks/${taskId}`
		});

		expect(
			Array.from(container.querySelectorAll('wa-button')).map((node) => node.textContent?.trim())
		).not.toContain('Edit');
	});

	test('renders the timezone note directly after the schedule text', () => {
		const { container } = render(ManagedTaskList, {
			tasks: [
				partnershipTask({
					id: 'partnership-task-2',
					schedule: {
						mode: 'scheduled',
						anchorLocal: '2026-09-20T10:00',
						frequency: 'week',
						interval: 1,
						weekdays: ['su'],
						end: { kind: 'never' }
					},
					timeZoneNote: {
						timeZone: 'America/Anchorage',
						referenceTimeZone: 'Europe/London',
						date: new Date('2026-09-20T09:00:00Z'),
						showCurrentTime: false
					}
				})
			],
			emptyMessage: 'No tasks'
		});

		const article = container.querySelector('article');
		const schedule = article?.querySelector('.schedule');
		const timezone = article?.querySelector('.timezone');
		if (!(schedule instanceof HTMLElement)) throw new Error('missing schedule');
		if (!(timezone instanceof HTMLElement)) throw new Error('missing timezone note');

		expect(schedule.nextElementSibling).toBe(timezone);
		expect(timezone.textContent).toContain('Anchorage time');
	});

	test('renders task actions in a separate right-hand column', () => {
		const { container } = render(ManagedTaskList, {
			tasks: [task()],
			emptyMessage: 'No tasks',
			completeAction: '?/completeTask',
			editHref: (taskId: string) => `/tasks/${taskId}`
		});

		const article = container.querySelector('article');
		const contentColumn = article?.querySelector('.content-column');
		const actionsColumn = article?.querySelector('.actions-column');
		if (!(contentColumn instanceof HTMLElement)) throw new Error('missing content column');
		if (!(actionsColumn instanceof HTMLElement)) throw new Error('missing actions column');

		expect(article?.lastElementChild).toBe(actionsColumn);
		expect(contentColumn.querySelector('.credits')).toBeNull();
		expect(actionsColumn.querySelector('.action-credits')?.textContent).toContain('+3 credits');
		expect(actionsColumn.querySelectorAll('wa-button')).toHaveLength(2);
	});

	test('renders inactive task credits with muted styling', () => {
		const { container } = render(ManagedTaskList, {
			tasks: [task({ active: false })],
			emptyMessage: 'No tasks',
			completeAction: '?/completeTask',
			editHref: (taskId: string) => `/tasks/${taskId}`
		});

		const credits = container.querySelector('.action-credits');
		if (!(credits instanceof HTMLElement)) throw new Error('missing action credits');

		expect(credits).toHaveClass('muted-credits');
	});
});
