import { expect } from '@playwright/test';
import { test } from './fixtures';

/**
 * The cross-links between the login and signup pages.
 *
 * This is e2e rather than jsdom because the interesting assertions are about
 * real URLs: that each page links to the other, and that a `redirectTo`
 * carrying an invite link survives the hop in both directions.
 */
test.describe('login/signup cross-links', () => {
	test('login links to signup, and signup links back to login', async ({ page }) => {
		await page.goto('/login');
		await expect(page.getByRole('link', { name: 'New here? Create an account' })).toHaveAttribute(
			'href',
			/\/signup$/
		);

		await page.goto('/signup');
		await expect(
			page.getByRole('link', { name: 'Already have an account? Log in' })
		).toHaveAttribute('href', /\/login$/);
	});

	test('a redirectTo survives the hop from login to signup', async ({ page }) => {
		// An arbitrary off-site value would have been dropped by safeRedirect in
		// the load, so use a real internal path: what an invite actually sends.
		await page.goto('/login?redirectTo=%2Finvite%2Fsome-token');
		const link = page.getByRole('link', { name: 'New here? Create an account' });
		await expect(link).toHaveAttribute(
			'href',
			'/signup?redirectTo=' + encodeURIComponent('/invite/some-token')
		);
	});

	test('a redirectTo survives the hop from signup to login', async ({ page }) => {
		await page.goto('/signup?redirectTo=%2Finvite%2Fsome-token');
		const link = page.getByRole('link', { name: 'Already have an account? Log in' });
		await expect(link).toHaveAttribute(
			'href',
			'/login?redirectTo=' + encodeURIComponent('/invite/some-token')
		);
	});

	test('following the cross-links keeps the redirect through a real round trip', async ({
		page
	}) => {
		await page.goto('/login?redirectTo=%2Finvite%2Fsome-token');
		await page.getByRole('link', { name: 'New here? Create an account' }).click();
		await page.waitForURL(/\/signup\?redirectTo=/);

		await page.getByRole('link', { name: 'Already have an account? Log in' }).click();
		await page.waitForURL(/\/login\?redirectTo=%2Finvite%2Fsome-token$/);
	});
});
