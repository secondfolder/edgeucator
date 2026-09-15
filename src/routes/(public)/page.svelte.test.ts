import { describe, test, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';

/**
 * `$app/state` is a live store fed by the router and `resolve()` needs the
 * generated route manifest — neither exists in a bare component render. Both
 * are mocked (the AppNav test's shape) so the test is about what the landing
 * decides, not about SvelteKit.
 */
const pageState = { data: { user: null as { id: string } | null } };

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

describe('/+page.svelte', () => {
	test('should render h1', () => {
		render(Page);
		expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
	});

	test('logged out: a signup CTA plus a small log-in link', () => {
		pageState.data.user = null;
		render(Page);

		// The big link is named "Sign up for Bound Up", deliberately not
		// "Sign up", which the site header already uses.
		expect(screen.getByRole('link', { name: 'Sign up for Bound Up' })).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Log in' })).toBeInTheDocument();
		expect(screen.queryByRole('link', { name: 'Sign up' })).not.toBeInTheDocument();
	});

	test('logged in: the CTA becomes Start and points at the app', () => {
		pageState.data.user = { id: 'u-ada' };
		render(Page);

		expect(screen.getByRole('link', { name: 'Start' })).toBeInTheDocument();
		expect(screen.queryByRole('link', { name: 'Log in' })).not.toBeInTheDocument();
	});
});
