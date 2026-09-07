import { describe, expect, test, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';
import type { PartnerView } from '$lib/types';

/**
 * `$app/state` is a live store fed by the router, and `resolve()` needs the
 * generated route manifest — neither exists in a bare component render. Both
 * are mocked so the test is about what the nav decides, not about SvelteKit.
 */
const pageState = {
	route: { id: '/(auth-required)/(app)/home' },
	params: {} as Record<string, string>
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

const { default: AppNav } = await import('./AppNav.svelte');

const partners: PartnerView[] = [
	{ id: 'p-ada', name: 'Ada', image: null },
	{ id: 'p-jun', name: 'Jun', image: '/jun.png' }
];

function renderNav(routeId: string, params: Record<string, string> = {}) {
	pageState.route.id = routeId;
	pageState.params = params;
	return render(AppNav, { partners });
}

describe('AppNav', () => {
	test('renders one tab per partner, between Home and Settings', () => {
		renderNav('/(auth-required)/(app)/home');

		const labels = screen.getAllByRole('link').map((link) => link.textContent?.trim());
		expect(labels).toEqual(['Home', 'Ada', 'Jun', 'Settings']);
	});

	test('renders no partner tabs when there are none', () => {
		pageState.route.id = '/(auth-required)/(app)/home';
		render(AppNav, { partners: [] });
		expect(screen.getAllByRole('link')).toHaveLength(2);
	});

	test('links each tab by partnership id', () => {
		renderNav('/(auth-required)/(app)/home');
		expect(screen.getByRole('link', { name: /Ada/ })).toHaveAttribute(
			'href',
			'/(auth-required)/(app)/partner/p-ada'
		);
	});

	test('marks Home current on a child route, not just the index', () => {
		// Both tabs own child routes, which is why the check is a prefix match.
		renderNav('/(auth-required)/(app)/home/guides/[id]', { id: 'g1' });
		expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
	});

	test('marks Settings current inside the partners screens', () => {
		renderNav('/(auth-required)/(app)/settings/partners/[id]', { id: 'p-ada' });
		expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
		// The partner tab must NOT light up just because a partner id is in the
		// params — the settings screens are not the partner page.
		expect(screen.getByRole('link', { name: /Ada/ })).not.toHaveAttribute('aria-current');
	});

	test('marks only the partner whose page is open', () => {
		renderNav('/(auth-required)/(app)/partner/[id]', { id: 'p-jun' });
		expect(screen.getByRole('link', { name: /Jun/ })).toHaveAttribute('aria-current', 'page');
		expect(screen.getByRole('link', { name: /Ada/ })).not.toHaveAttribute('aria-current');
		expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
	});

	test('falls back to initials when a partner has no picture', () => {
		const { container } = renderNav('/(auth-required)/(app)/home');
		const avatars = container.querySelectorAll('wa-avatar');

		expect(avatars[0]).toHaveAttribute('initials', 'A');
		// An empty image="" would render as a broken image, so it is left off.
		expect(avatars[0].hasAttribute('image')).toBe(false);
		expect(avatars[1]).toHaveAttribute('image', '/jun.png');
	});
});
