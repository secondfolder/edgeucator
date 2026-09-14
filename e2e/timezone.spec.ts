import { createClient } from '@libsql/client';
import type { Browser, Response } from '@playwright/test';
import { expect, test } from './fixtures';
import {
	account,
	clickWaButton,
	createInvite,
	logIn,
	signUp,
	waitForEnhancedForm
} from './helpers';

function db() {
	return createClient({ url: 'file:e2e.db' });
}

async function readTimezone(email: string): Promise<string> {
	const client = db();
	try {
		const result = await client.execute({
			sql: 'select timezone from user where email = ?',
			args: [email]
		});
		return String(result.rows[0]?.timezone ?? '');
	} finally {
		client.close();
	}
}

async function newDevice(browser: Browser, timezoneId: string) {
	return browser.newContext({
		permissions: ['clipboard-read', 'clipboard-write'],
		timezoneId
	});
}

test.describe('timezone settings', () => {
	test('stores the device timezone at signup', async ({ browser }) => {
		const who = account('Tara');
		const context = await newDevice(browser, 'America/New_York');

		try {
			const page = await context.newPage();
			await signUp(page, who);
			expect(await readTimezone(who.email)).toBe('America/New_York');
		} finally {
			await context.close();
		}
	});

	test('lets the account page change the stored timezone and keeps it after reload', async ({
		browser
	}) => {
		const who = account('Uma');
		const context = await newDevice(browser, 'Europe/London');

		try {
			const page = await context.newPage();
			await signUp(page, who);

			await page.goto('/settings/account');
			await waitForEnhancedForm(page);
			await page.getByLabel('Timezone').fill('Los');
			await page.getByRole('option', { name: 'America/Los_Angeles' }).click();
			await Promise.all([
				page.waitForResponse(
					(response: Response) =>
						response.request().method() === 'POST' && response.url().includes('/settings/account')
				),
				clickWaButton(page, 'Save account details')
			]);

			await page.reload();
			await waitForEnhancedForm(page);
			await expect(page.getByLabel('Timezone')).toHaveValue('America/Los_Angeles');
			expect(await readTimezone(who.email)).toBe('America/Los_Angeles');
		} finally {
			await context.close();
		}
	});

	test('shows the mismatch banner on home, partner, and settings after logging in from a different timezone', async ({
		browser
	}) => {
		const ada = account('Vera');
		const jun = account('Jun');
		const setupA = await newDevice(browser, 'Europe/London');
		const setupB = await newDevice(browser, 'Europe/London');

		try {
			const adaPage = await setupA.newPage();
			const junPage = await setupB.newPage();
			await signUp(adaPage, ada);
			await signUp(junPage, jun);

			const invite = await createInvite(adaPage, {
				partnerName: jun.name,
				yourName: ada.name,
				control: 'mix'
			});
			await junPage.goto(invite);
			await clickWaButton(junPage, 'Accept and link');
			await junPage.waitForURL(/\/partner\//);
		} finally {
			await setupA.close();
			await setupB.close();
		}

		const differentDevice = await newDevice(browser, 'America/New_York');
		try {
			const page = await differentDevice.newPage();
			await logIn(page, ada);

			await expect(page.getByText('This device is in a different timezone')).toBeVisible();
			await expect(page.getByText(/account is set to Europe\/London/i)).toBeVisible();

			await page
				.getByRole('navigation', { name: 'Primary' })
				.getByRole('link', { name: /Jun/ })
				.click();
			await page.waitForURL(/\/partner\//);
			await expect(page.getByText('This device is in a different timezone')).toBeVisible();

			await page.goto('/settings');
			await expect(page.getByText('This device is in a different timezone')).toBeVisible();
		} finally {
			await differentDevice.close();
		}
	});

	test('keeps a dismissal on the same device profile and clears it when that profile timezone changes', async ({
		browser
	}) => {
		const who = account('Willa');
		const signupDevice = await newDevice(browser, 'Europe/London');

		try {
			const page = await signupDevice.newPage();
			await signUp(page, who);
		} finally {
			await signupDevice.close();
		}

		const device = await newDevice(browser, 'America/New_York');
		let state;
		try {
			const page = await device.newPage();
			await logIn(page, who);
			await expect(page.getByText('This device is in a different timezone')).toBeVisible();
			await clickWaButton(page, 'Dismiss');
			await expect(page.getByText('This device is in a different timezone')).toHaveCount(0);

			await page.reload();
			await expect(page.getByText('This device is in a different timezone')).toHaveCount(0);
			state = await device.storageState();
		} finally {
			await device.close();
		}

		const sameTimezone = await browser.newContext({
			permissions: ['clipboard-read', 'clipboard-write'],
			storageState: state,
			timezoneId: 'America/New_York'
		});
		try {
			const page = await sameTimezone.newPage();
			await page.goto('/home');
			await expect(page.getByText('This device is in a different timezone')).toHaveCount(0);
		} finally {
			await sameTimezone.close();
		}

		const changedTimezone = await browser.newContext({
			permissions: ['clipboard-read', 'clipboard-write'],
			storageState: state,
			timezoneId: 'Asia/Tokyo'
		});
		try {
			const page = await changedTimezone.newPage();
			await page.goto('/home');
			await expect(page.getByText('This device is in a different timezone')).toBeVisible();
		} finally {
			await changedTimezone.close();
		}
	});

	test('updates the account timezone from the banner and removes the prompt', async ({
		browser
	}) => {
		const who = account('Xena');
		const signupDevice = await newDevice(browser, 'Europe/London');

		try {
			const page = await signupDevice.newPage();
			await signUp(page, who);
		} finally {
			await signupDevice.close();
		}

		const differentDevice = await newDevice(browser, 'America/New_York');
		try {
			const page = await differentDevice.newPage();
			await logIn(page, who);
			await expect(page.getByText('This device is in a different timezone')).toBeVisible();

			await Promise.all([
				page.waitForResponse(
					(response: Response) =>
						response.request().method() === 'POST' &&
						response.url().includes('/api/account/timezone')
				),
				clickWaButton(page, 'Use America/New_York')
			]);

			await expect(page.getByText('This device is in a different timezone')).toHaveCount(0);
			expect(await readTimezone(who.email)).toBe('America/New_York');

			await page.goto('/settings/account');
			await waitForEnhancedForm(page);
			await expect(page.getByLabel('Timezone')).toHaveValue('America/New_York');
		} finally {
			await differentDevice.close();
		}
	});
});
