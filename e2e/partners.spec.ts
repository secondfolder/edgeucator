import { expect, test } from './fixtures';
import {
	clickWaButton,
	createInvite,
	fillPassword,
	logOut,
	navTabs,
	newSide,
	signUp
} from './helpers';

/**
 * The whole partner feature over HTTP, in a real browser.
 *
 * Each test uses two browser contexts so the two accounts hold genuinely
 * separate session cookies — signing out and back in inside one context would
 * pass while hiding a cookie bug.
 */

test.describe('linking two accounts', () => {
	test('an invite survives the whole round trip, and both sides end up linked', async ({
		browser
	}) => {
		const ada = await newSide(browser, 'Ada');
		const jun = await newSide(browser, 'Jun');

		try {
			await signUp(ada.page, ada.who);
			await ada.page.waitForURL('**/home');

			// A brand new account has no partner tabs.
			expect(await navTabs(ada.page)).toEqual(['Home', 'Settings']);

			const link = await createInvite(ada.page, {
				partnerName: 'Jun',
				yourName: 'Ada',
				partnerRole: 'sub',
				yourRole: 'dom',
				control: 'mix'
			});

			// It shows as pending, and still not in the nav — there is nobody
			// behind that tab until it is accepted.
			await ada.page.goto('/settings/partners');
			await expect(ada.page.getByText('Waiting for them to accept')).toBeVisible();
			expect(await navTabs(ada.page)).toEqual(['Home', 'Settings']);

			// Jun opens the link cold, with no account at all.
			await jun.page.goto(link);
			await expect(
				jun.page.getByRole('heading', { name: 'Ada wants to add you as a partner' })
			).toBeVisible();

			await jun.page.getByRole('link', { name: 'Create an account' }).click();
			await jun.page.waitForURL(/\/signup\?redirectTo=/);
			await signUp(jun.page, jun.who, jun.page.url());

			// Signing up must land back on the invite, not on /home.
			await jun.page.waitForURL(/\/invite\//);
			await expect(
				jun.page.getByRole('heading', { name: 'Ada wants to add you as a partner' })
			).toBeVisible();

			// Control is shared, so Jun may rewrite the names before accepting.
			await expect(jun.page.locator('wa-input[name="partnerName"]')).toBeVisible();
			await clickWaButton(jun.page, 'Accept and link');
			await jun.page.waitForURL(/\/partner\/[0-9a-f-]{36}/);

			// Each side sees the other under the name that side chose.
			await expect(jun.page.getByRole('heading', { name: 'Ada' })).toBeVisible();
			expect(await navTabs(jun.page)).toEqual(['Home', 'Ada', 'Settings']);

			await ada.page.goto('/home');
			expect(await navTabs(ada.page)).toEqual(['Home', 'Jun', 'Settings']);

			// The link is spent.
			await jun.page.goto(link);
			await expect(jun.page.getByRole('heading', { name: "This link doesn't work" })).toBeVisible();
		} finally {
			await ada.close();
			await jun.close();
		}
	});

	test('the accepter cannot edit the names when the inviter keeps control', async ({ browser }) => {
		const ada = await newSide(browser, 'Ada');
		const jun = await newSide(browser, 'Jun');

		try {
			await signUp(ada.page, ada.who);
			await ada.page.waitForURL('**/home');
			const link = await createInvite(ada.page, {
				partnerName: 'Jun',
				yourName: 'Ada',
				control: 'me'
			});

			await signUp(jun.page, jun.who);
			await jun.page.waitForURL('**/home');
			await jun.page.goto(link);

			// Displayed, not editable — the requirement for "they're in control".
			// The control question is not shown at all; the page instead says what
			// accepting would hand over.
			await expect(jun.page.locator('wa-input[name="partnerName"]')).toHaveCount(0);
			await expect(jun.page.getByText('Ada', { exact: true })).toBeVisible();
			// Matched in pieces: the sentence wraps across lines in the source, and
			// Playwright matches regexes against the un-normalised text.
			await expect(jun.page.getByText(/they'll be able to set/)).toBeVisible();
			await expect(jun.page.getByText(/tasks, rewards and punishments for you/)).toBeVisible();
			await expect(jun.page.locator('input[name="control"][type="radio"]')).toHaveCount(0);

			await clickWaButton(jun.page, 'Accept and link');
			await jun.page.waitForURL(/\/partner\//);

			// And the settings screen offers no edit form either.
			await jun.page.getByRole('link', { name: 'Connection settings' }).click();
			await expect(jun.page.getByText("They're in control of this link")).toBeVisible();
			await expect(jun.page.getByRole('button', { name: 'Save' })).toHaveCount(0);
			// ...but leaving is always available.
			await expect(jun.page.getByRole('button', { name: 'Disconnect' })).toBeVisible();
		} finally {
			await ada.close();
			await jun.close();
		}
	});

	test('an anonymous visitor is sent to log in and comes back to the invite', async ({
		browser
	}) => {
		const ada = await newSide(browser, 'Ada');
		const jun = await newSide(browser, 'Jun');

		try {
			await signUp(jun.page, jun.who);
			await logOut(jun.page);

			await signUp(ada.page, ada.who);
			await ada.page.waitForURL('**/home');
			const link = await createInvite(ada.page, {
				partnerName: 'Jun',
				yourName: 'Ada',
				control: 'mix'
			});

			await jun.page.goto(link);
			await jun.page.getByRole('link', { name: 'Log in to accept' }).click();
			await jun.page.waitForURL(/\/login\?redirectTo=/);

			await jun.page.locator('wa-input[name="email"] input').fill(jun.who.email);
			// Through the helper: the password box carries no `name`, only
			// `data-field` — see PasswordField.svelte.
			await fillPassword(jun.page, 'password', jun.who.password);
			await clickWaButton(jun.page, 'Login');

			// Logging in must return them to the invite rather than to /home.
			await jun.page.waitForURL(/\/invite\//);
			await expect(jun.page.getByRole('button', { name: 'Accept and link' })).toBeVisible();
		} finally {
			await ada.close();
			await jun.close();
		}
	});
});

test.describe('managing a link', () => {
	test('disconnecting removes the partner from both navs', async ({ browser }) => {
		const ada = await newSide(browser, 'Ada');
		const jun = await newSide(browser, 'Jun');

		try {
			await signUp(ada.page, ada.who);
			await ada.page.waitForURL('**/home');
			const link = await createInvite(ada.page, {
				partnerName: 'Jun',
				yourName: 'Ada',
				control: 'me'
			});

			await signUp(jun.page, jun.who);
			await jun.page.waitForURL('**/home');
			await jun.page.goto(link);
			await clickWaButton(jun.page, 'Accept and link');
			await jun.page.waitForURL(/\/partner\//);
			expect(await navTabs(jun.page)).toEqual(['Home', 'Ada', 'Settings']);

			// Jun does not hold control, and must still be able to leave.
			await jun.page.goto('/settings/partners');
			await jun.page.getByRole('main').getByRole('link', { name: /Ada/ }).click();
			jun.page.once('dialog', (dialog) => dialog.accept());
			await clickWaButton(jun.page, 'Disconnect');
			await jun.page.waitForURL('**/settings/partners');

			await expect(jun.page.getByText('You have no partners yet.')).toBeVisible();
			expect(await navTabs(jun.page)).toEqual(['Home', 'Settings']);

			await ada.page.goto('/home');
			expect(await navTabs(ada.page)).toEqual(['Home', 'Settings']);
		} finally {
			await ada.close();
			await jun.close();
		}
	});

	test('the inviter can cancel a pending invite, which kills the link', async ({ browser }) => {
		const ada = await newSide(browser, 'Ada');
		const jun = await newSide(browser, 'Jun');

		try {
			await signUp(ada.page, ada.who);
			await ada.page.waitForURL('**/home');
			const link = await createInvite(ada.page, {
				partnerName: 'Jun',
				yourName: 'Ada',
				control: 'mix'
			});

			ada.page.once('dialog', (dialog) => dialog.accept());
			await clickWaButton(ada.page, 'Cancel invite');
			await ada.page.waitForURL('**/settings/partners');
			await expect(ada.page.getByText('You have no partners yet.')).toBeVisible();

			await jun.page.goto(link);
			await expect(jun.page.getByRole('heading', { name: "This link doesn't work" })).toBeVisible();
		} finally {
			await ada.close();
			await jun.close();
		}
	});

	test('renewing an invite replaces the old link', async ({ browser }) => {
		const ada = await newSide(browser, 'Ada');
		const jun = await newSide(browser, 'Jun');

		try {
			await signUp(ada.page, ada.who);
			await ada.page.waitForURL('**/home');
			const first = await createInvite(ada.page, {
				partnerName: 'Jun',
				yourName: 'Ada',
				control: 'mix'
			});

			await clickWaButton(ada.page, 'Create a new link');
			await expect(ada.page.getByLabel('Invite link')).not.toHaveValue(first);
			const second = await ada.page.getByLabel('Invite link').inputValue();

			await jun.page.goto(first);
			await expect(jun.page.getByRole('heading', { name: "This link doesn't work" })).toBeVisible();

			await jun.page.goto(second);
			await expect(
				jun.page.getByRole('heading', { name: 'Ada wants to add you as a partner' })
			).toBeVisible();
		} finally {
			await ada.close();
			await jun.close();
		}
	});

	test('the controlling side can rename the partner, and the nav follows', async ({ browser }) => {
		const ada = await newSide(browser, 'Ada');
		const jun = await newSide(browser, 'Jun');

		try {
			await signUp(ada.page, ada.who);
			await ada.page.waitForURL('**/home');
			const link = await createInvite(ada.page, {
				partnerName: 'Jun',
				yourName: 'Ada',
				control: 'me'
			});

			await signUp(jun.page, jun.who);
			await jun.page.waitForURL('**/home');
			await jun.page.goto(link);
			await clickWaButton(jun.page, 'Accept and link');
			await jun.page.waitForURL(/\/partner\//);

			await ada.page.goto('/settings/partners');
			await ada.page.getByRole('main').getByRole('link', { name: /Jun/ }).click();
			await ada.page.locator('wa-input[name="partnerName"] input').fill('Junie');
			await clickWaButton(ada.page, 'Save');

			await expect(async () => {
				expect(await navTabs(ada.page)).toEqual(['Home', 'Junie', 'Settings']);
			}).toPass();

			// Jun's own tab is unaffected: it shows what Jun calls Ada.
			await jun.page.goto('/home');
			expect(await navTabs(jun.page)).toEqual(['Home', 'Ada', 'Settings']);
		} finally {
			await ada.close();
			await jun.close();
		}
	});
});
