import { describe, expect, test, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';
import type { PageData } from './$types';

const pageState = {
	data: {
		user: { id: 'u1', name: 'Ada', email: 'ada@example.com', image: null, timezone: 'UTC' }
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

function renderPage(hasMessageHistory: boolean) {
	return render(Page, { data: { hasMessageHistory } as PageData });
}

describe('/settings/+page.svelte', () => {
	test('renders the signed-in panel with the logout form inside it', () => {
		const { container } = renderPage(false);

		expect(screen.getByText('Signed in as')).toBeInTheDocument();
		expect(screen.getByText('Ada')).toBeInTheDocument();
		expect(screen.getByText('ada@example.com')).toBeInTheDocument();

		const panel = container.querySelector('.account');
		expect(panel).not.toBeNull();
		expect(panel?.querySelector('form[action="/logout"]')).not.toBeNull();
		expect(container.querySelectorAll('form')).toHaveLength(1);
		expect(panel?.textContent).toContain('Log out');
	});

	test('always shows the account, security, and partners links', () => {
		renderPage(false);

		expect(screen.getByRole('link', { name: 'Account' })).toHaveAttribute(
			'href',
			'/(auth-required)/(app)/settings/account'
		);
		expect(screen.getByRole('link', { name: 'Security' })).toHaveAttribute(
			'href',
			'/(auth-required)/(app)/settings/security'
		);
		expect(screen.getByRole('link', { name: 'Partners' })).toHaveAttribute(
			'href',
			'/(auth-required)/(app)/settings/partners'
		);
	});

	test('hides the encrypted-messages link without message history', () => {
		renderPage(false);
		expect(screen.queryByRole('link', { name: 'Encrypted messages' })).not.toBeInTheDocument();
	});

	test('shows the encrypted-messages link once message history exists', () => {
		renderPage(true);
		expect(screen.getByRole('link', { name: 'Encrypted messages' })).toHaveAttribute(
			'href',
			'/(auth-required)/(app)/settings/encryption'
		);
	});
});
