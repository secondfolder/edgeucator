import { describe, expect, test, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/svelte';
import type { PageData } from './$types';

vi.mock('$app/paths', () => ({
	resolve: (id: string, params?: Record<string, string>) =>
		params ? id.replace(/\[(\w+)\]/g, (_, key) => params[key]) : id
}));

const { default: Page } = await import('./+page.svelte');

function data({
	canManageTasks = true,
	canCompleteTasks = true,
	tasks = []
}: {
	canManageTasks?: boolean;
	canCompleteTasks?: boolean;
	tasks?: PageData['tasks'];
} = {}): PageData {
	return {
		user: {
			id: 'u1',
			name: 'Ada',
			email: 'ada@example.com',
			image: null,
			timezone: 'Europe/London'
		},
		partners: [{ id: 'p1', name: 'Jun', image: null }],
		userHasMessageHistory: false,
		partner: {
			id: 'p1',
			name: 'Jun',
			canManageTasks,
			canCompleteTasks,
			counterpartUserId: 'u2',
			counterpartTimezone: 'America/New_York'
		},
		tasks,
		completions: []
	} as PageData;
}

describe('/partner/[id]/tasks/+page.svelte', () => {
	test('shows task and history actions together for one-sided managing control', () => {
		const { container } = render(Page, {
			data: data({ canManageTasks: true, canCompleteTasks: false })
		});
		const buttons = Array.from(container.querySelectorAll('wa-button')).map((node) =>
			node.textContent?.trim()
		);
		expect(buttons).toContain('Add a task');
		expect(buttons).toContain('Completion History');
		expect(container.textContent).not.toContain('Recent Task Completions');
		expect(container.querySelectorAll('.panel')).toHaveLength(0);
	});

	test('shows a single unsplit task section for the non-managing side', () => {
		const { container } = render(Page, {
			data: data({ canManageTasks: false, canCompleteTasks: true })
		});
		expect(container.textContent).not.toContain('Add a task');
		expect(container.textContent).toContain('Completion History');
		expect(container.textContent).not.toContain('Tasks for you');
		expect(container.textContent).not.toContain('Tasks for Jun');
		expect(container.querySelectorAll('.panel')).toHaveLength(0);
	});

	test('splits shared-control tasks into sections for you and your partner', () => {
		const tasks = [
			{
				id: 'task-1',
				title: 'From Jun',
				description: null,
				active: true,
				creditsAwarded: 1,
				completionMessages: [],
				schedule: { mode: 'one-off' },
				timezoneOwnerUserId: 'u2',
				lastCompletedAt: null,
				completedCount: 0,
				nextEligibleAt: null,
				createdByMe: false,
				canManage: true,
				canComplete: true,
				createdAt: new Date(),
				updatedAt: new Date(),
				timeZoneNote: null
			},
			{
				id: 'task-2',
				title: 'For Jun',
				description: null,
				active: true,
				creditsAwarded: 1,
				completionMessages: [],
				schedule: { mode: 'one-off' },
				timezoneOwnerUserId: 'u1',
				lastCompletedAt: null,
				completedCount: 0,
				nextEligibleAt: null,
				createdByMe: true,
				canManage: true,
				canComplete: false,
				createdAt: new Date(),
				updatedAt: new Date(),
				timeZoneNote: null
			}
		] satisfies PageData['tasks'];

		const { container } = render(Page, {
			data: data({ canManageTasks: true, canCompleteTasks: true, tasks })
		});
		const panels = Array.from(container.querySelectorAll('.panel'));
		expect(container.textContent).toContain('Tasks for you');
		expect(container.textContent).toContain('Tasks for Jun');
		expect(container.textContent).not.toContain('Recent Task Completions');
		expect(container.textContent?.match(/Completion History/g)?.length).toBe(2);
		expect(container.textContent?.match(/Add a task/g)?.length).toBe(1);
		expect(panels[0]?.textContent).toContain('Tasks for you');
		expect(panels[0]?.textContent).not.toContain('Add a task');
		expect(panels[1]?.textContent).toContain('Tasks for Jun');
		expect(panels[1]?.textContent).toContain('Add a task');
	});
});
