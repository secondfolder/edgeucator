import { expect, test } from './fixtures';
import {
	account,
	clickWaButton,
	fillPassword,
	fillWaInput,
	openBoard,
	signUp,
	uniqueEmail,
	waitForEnhancedForm,
	writeThread
} from './helpers';

test.describe('settings information architecture', () => {
	test('hides encrypted messages on settings until the user has message history', async ({
		browser,
		page
	}) => {
		const ada = account('Ada');
		const jun = account('Jun');

		await signUp(page, ada);
		await page.goto('/settings');
		await expect(page.getByRole('link', { name: 'Account' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Security' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Partners' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Encrypted messages' })).toHaveCount(0);
		await expect(page.locator('.account').getByRole('button', { name: 'Log out' })).toBeVisible();

		const second = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
		try {
			const junPage = await second.newPage();
			await signUp(junPage, jun);

			await page.goto('/settings/partners');
			await page.getByRole('link', { name: 'Add' }).click();
			await page.waitForURL('**/settings/partners/new');
			await fillWaInput(page, 'partnerName', jun.name);
			await fillWaInput(page, 'yourName', ada.name);
			await page.locator('input[name="control"][value="mix"]').check();
			await clickWaButton(page, 'Create invite link');
			await page.waitForURL(/\/settings\/partners\/[0-9a-f-]{36}$/);
			const invite = await page.getByLabel('Invite link').inputValue();

			await junPage.goto(invite);
			await clickWaButton(junPage, 'Accept and link');
			await junPage.waitForURL(/\/partner\//);

			await page.goto('/home');
			await openBoard(page, jun.name);

			await writeThread(page, 'First thread so settings should show encryption');

			await page.goto('/settings');
			await expect(page.getByRole('link', { name: 'Encrypted messages' })).toBeVisible();
		} finally {
			await second.close();
		}
	});

	test('uses nested sub-pages for account, security, and encrypted messages', async ({ page }) => {
		const who = account('Nia');
		await signUp(page, who);

		await page.goto('/settings/account');
		await expect(page.getByRole('link', { name: 'Back to settings' })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible();
		await expect(page.getByText(/Email changes are not available yet/)).toBeVisible();
		await expect(page.getByRole('link', { name: 'Open security settings' })).toBeVisible();

		await page.goto('/settings/security');
		await expect(page.getByRole('link', { name: 'Back to settings' })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Security' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Open encrypted messages' })).toBeVisible();

		await page.goto('/settings/encryption');
		await expect(page.getByRole('link', { name: 'Back to settings' })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Encrypted messages' })).toBeVisible();
		await expect(page.getByText(/Use Security/)).toBeVisible();
	});

	test('renames passkeys settings to security and redirects old deep links', async ({ page }) => {
		const who = account('Oren');
		await signUp(page, who);

		await page.goto('/settings/passkeys');
		await page.waitForURL('/settings/security');
		await expect(page.getByRole('heading', { name: 'Security' })).toBeVisible();
		await expect(
			page.getByText('Passkeys let you sign in with your device instead of a password.')
		).toBeVisible();
	});
});

test.describe('settings actions', () => {
	test('updates the account name from the account page', async ({ page }) => {
		const who = account('Pia');
		await signUp(page, who);

		await page.goto('/settings/account');
		await waitForEnhancedForm(page);
		await fillWaInput(page, 'name', 'Pia Newname');
		await Promise.all([
			page.waitForResponse(
				(response) =>
					response.request().method() === 'POST' && response.url().includes('/settings/account')
			),
			clickWaButton(page, 'Save account details')
		]);

		await page.goto('/settings');
		await expect(page.locator('.account .name')).toHaveText('Pia Newname');
	});

	test('changes the password from the security page and the new password unlocks a cleared browser', async ({
		browser
	}) => {
		const who = account('Quinn');
		const newPassword = 'vocalist-hazy-radar-plunge';

		const first = await browser.newContext();
		let cookies;
		try {
			const page = await first.newPage();
			await signUp(page, who);
			await page.goto('/settings/security');
			await waitForEnhancedForm(page);

			await fillPassword(page, 'oldPassword', who.password);
			await fillPassword(page, 'newPassword', newPassword);
			await fillPassword(page, 'newConfirm', newPassword);
			await clickWaButton(page, 'Change password');
			await expect(page.locator('wa-input[data-field="oldPassword"] input')).toHaveValue('');

			cookies = await first.cookies();
		} finally {
			await first.close();
		}

		const evicted = await browser.newContext();
		try {
			await evicted.addCookies(cookies);
			const page = await evicted.newPage();
			await page.goto('/settings/encryption');
			await expect(page.getByText(/Locked on this device/)).toBeVisible();

			await fillPassword(page, 'unlockPassword', who.password);
			await clickWaButton(page, 'Unlock messages');
			await expect(page.getByText(/did not unlock your messages/)).toBeVisible();

			await fillPassword(page, 'unlockPassword', newPassword);
			await clickWaButton(page, 'Unlock messages');
			await expect(page.getByText(/Your messages are unlocked here/)).toBeVisible();
		} finally {
			await evicted.close();
		}
	});

	test('shows the read-only email explanation on the account page', async ({ page }) => {
		const who = { name: 'Rhea', email: uniqueEmail('rhea'), password: 'correct-horse-battery' };
		await signUp(page, who);

		await page.goto('/settings/account');
		await expect(page.getByText(who.email)).toBeVisible();
		await expect(page.getByText(/Email changes are not available yet/)).toBeVisible();
	});

	test('signs out from the signed-in panel on settings', async ({ page }) => {
		const who = account('Seth');
		await signUp(page, who);

		await page.goto('/settings');
		await expect(page.locator('.account').getByRole('button', { name: 'Log out' })).toBeVisible();
		await clickWaButton(page, 'Log out');
		await page.waitForURL('/');
	});
});
