import { describe, expect, test, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/svelte';
import type { PageData } from './$types';

vi.mock('$app/paths', () => ({
	resolve: (id: string, params?: Record<string, string>) =>
		params ? id.replace(/\[(\w+)\]/g, (_, key) => params[key]) : id
}));

const { default: Page } = await import('./+page.svelte');

function data(claimCount: number, claimable = true): PageData {
	return {
		user: { id: 'u1', name: 'Ada', email: 'ada@example.com', image: null, timezone: 'UTC' },
		partners: [{ id: 'p1', name: 'Jun', image: null }],
		userHasMessageHistory: false,
		partner: { id: 'p1', name: 'Jun', canManageRewards: true, canClaimRewards: claimable },
		counterpartUserId: 'u2',
		viewerCredits: 4,
		counterpartCredits: 1,
		rewards: [
			{
				id: 'r1',
				title: 'Tea',
				description: 'Fresh pot first',
				cost: 2,
				active: true,
				createdByMe: false,
				canClaim: claimable,
				createdAt: new Date(),
				updatedAt: new Date()
			}
		],
		claims: Array.from({ length: claimCount }, (_, index) => ({
			id: `c${index}`,
			rewardTitle: 'Tea',
			rewardDescription: null,
			rewardCost: 2,
			mine: false,
			createdByMe: false,
			createdAt: new Date()
		}))
	};
}

describe('/partner/[id]/rewards/+page.svelte', () => {
	test('hides claim history when the partnership has no claims', () => {
		const { container } = render(Page, { data: data(0) });
		expect(container.textContent).not.toContain('Claim history');
	});

	test('shows claim history when the partnership has claims', () => {
		const { container } = render(Page, { data: data(1) });
		const buttons = Array.from(container.querySelectorAll('wa-button')).map((node) =>
			node.textContent?.trim()
		);
		expect(buttons).toContain('Claim history');
	});

	test('hides claim-side credits and claim controls for the controller-only view', () => {
		const { container } = render(Page, { data: data(0, false) });
		expect(container.querySelector('.title-row')?.textContent).toContain("Jun's Rewards");
		expect(container.querySelector('.title-row')?.textContent).toContain('Credits:');
		expect(container.querySelector('.title-row')?.textContent).toContain('1');
		expect(container.textContent).not.toContain('Claim');
		expect(container.textContent).not.toContain('You need 2 credits.');
		expect(container.textContent).not.toContain("Jun's credits");
	});
});
