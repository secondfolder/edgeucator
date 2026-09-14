import { describe, expect, test, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/svelte';
import type { PageData } from './$types';

vi.mock('$app/paths', () => ({
	resolve: (id: string, params?: Record<string, string>) =>
		params ? id.replace(/\[(\w+)\]/g, (_, key) => params[key]) : id
}));

const { default: Page } = await import('./+page.svelte');

function data(claimCount: number): PageData {
	return {
		user: { id: 'u1', name: 'Ada', email: 'ada@example.com', image: null, timezone: 'UTC' },
		partners: [{ id: 'p1', name: 'Jun', image: null }],
		userHasMessageHistory: false,
		selfRewards: {
			credits: 3,
			rewards: [],
			claims: Array.from({ length: claimCount }, (_, index) => ({
				id: `c${index}`,
				rewardTitle: 'Bath',
				rewardDescription: null,
				rewardCost: 2,
				createdAt: new Date()
			}))
		},
		partnerRewards: [
			{
				partnershipId: 'p1',
				name: 'Jun',
				image: null,
				credits: 4,
				rewards: []
			}
		]
	};
}

describe('/home/rewards/+page.svelte', () => {
	test('hides claim history when there are no self claims', () => {
		const { container } = render(Page, { data: data(0) });
		expect(container.textContent).not.toContain('Claim history');
	});

	test('shows claim history when self claims exist', () => {
		const { container } = render(Page, { data: data(1) });
		const buttons = Array.from(container.querySelectorAll('wa-button')).map((node) =>
			node.textContent?.trim()
		);
		expect(buttons).toContain('Claim history');
	});

	test('uses the controller-style header format for self and partner sections', () => {
		const { container } = render(Page, { data: data(0) });
		const rows = container.querySelectorAll('.title-row');
		expect(rows[0]?.textContent).toContain('Your Rewards');
		expect(rows[0]?.textContent).toContain('Credits:');
		expect(rows[0]?.textContent).toContain('3');
		expect(rows[1]?.textContent).toContain("Jun's Rewards");
		expect(rows[1]?.textContent).toContain('Credits:');
		expect(rows[1]?.textContent).toContain('4');
	});
});
