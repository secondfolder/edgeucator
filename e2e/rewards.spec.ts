import { expect, test } from './fixtures';
import { clickWaButton, createInvite, fillRichText, newSide, signUp } from './helpers';

test.describe('rewards', () => {
	test('a user can manage and claim self rewards from home', async ({ browser }) => {
		const ada = await newSide(browser, 'Ada');

		try {
			await signUp(ada.page, ada.who);
			await ada.page.waitForURL('**/home');
			await ada.page.getByRole('link', { name: 'Rewards' }).click();
			await ada.page.waitForURL(/\/home\/rewards$/);

			await ada.page.getByRole('button', { name: 'Edit your reward credits' }).click();
			await ada.page.getByLabel('Set your reward credits').fill('4');
			await ada.page.getByRole('button', { name: 'Save your reward credits' }).click();
			await expect(ada.page.locator('.self .title-row')).toContainText('Your Rewards');
			await expect(ada.page.locator('.self .title-row')).toContainText('Credits: 4');

			await ada.page.getByRole('link', { name: 'Add a reward' }).click();
			await ada.page.waitForURL(/\/home\/rewards\/add$/);
			await ada.page.locator('.add-form input[name="title"]').first().fill('Long bath');
			await fillRichText(ada.page.locator('.add-form'), 'No interruptions');
			await ada.page.locator('.add-form input[name="cost"]').first().fill('2');
			await clickWaButton(ada.page, 'Add reward');
			await ada.page.waitForURL(/\/home\/rewards$/);

			await expect(ada.page.getByRole('heading', { name: 'Long bath' })).toBeVisible();
			await clickWaButton(ada.page, 'Claim');
			await expect(ada.page.locator('.self .title-row')).toContainText('Credits: 2');

			await ada.page.getByRole('link', { name: 'Claim history' }).click();
			await ada.page.waitForURL(/\/home\/rewards\/history$/);
			await expect(ada.page.getByText('Long bath')).toBeVisible();
			await expect(ada.page.getByRole('heading', { name: 'Self reward history' })).toBeVisible();
		} finally {
			await ada.close();
		}
	});

	test('a controller can create partner rewards and the other side can claim them from home', async ({
		browser
	}) => {
		const ada = await newSide(browser, 'Ada');
		const jun = await newSide(browser, 'Jun');

		try {
			await signUp(ada.page, ada.who);
			await ada.page.waitForURL('**/home');
			await ada.page.getByRole('link', { name: 'Rewards' }).click();
			await ada.page.waitForURL(/\/home\/rewards$/);
			const link = await createInvite(ada.page, {
				partnerName: 'Jun',
				yourName: 'Ada',
				control: 'them'
			});

			await signUp(jun.page, jun.who);
			await jun.page.waitForURL('**/home');
			await jun.page.goto(link);
			await clickWaButton(jun.page, 'Accept and link');
			await jun.page.waitForURL(/\/partner\/[0-9a-f-]{36}$/);

			await jun.page.getByRole('link', { name: 'Rewards' }).click();
			await jun.page.waitForURL(/\/rewards$/);
			await jun.page.getByRole('button', { name: "Edit Ada's reward credits" }).click();
			await jun.page.getByLabel("Set Ada's reward credits").fill('4');
			await jun.page.getByRole('button', { name: "Save Ada's reward credits" }).click();

			await jun.page.getByRole('link', { name: 'Add a reward' }).click();
			await jun.page.waitForURL(/\/rewards\/add$/);
			await jun.page.locator('.add-form input[name="title"]').fill('Tea service');
			await fillRichText(jun.page.locator('.add-form'), 'Fresh pot first');
			await jun.page.locator('.add-form input[name="cost"]').fill('2');
			await clickWaButton(jun.page, 'Add reward');
			await jun.page.waitForURL(/\/rewards$/);
			await expect(jun.page.getByRole('heading', { name: 'Tea service' })).toBeVisible();

			await ada.page.goto('/home/rewards');
			await expect(ada.page.getByRole('heading', { name: 'Jun' })).toBeVisible();
			await expect(ada.page.locator('.partner .title-row').first()).toContainText('Jun');
			await expect(ada.page.locator('.partner .title-row').first()).toContainText('Credits: 4');
			await clickWaButton(ada.page, 'Claim');
			await expect(ada.page.locator('.partner .title-row').first()).toContainText('Credits: 2');

			await ada.page.getByRole('link', { name: 'Open full rewards' }).click();
			await ada.page.waitForURL(/\/rewards$/);
			await ada.page.getByRole('link', { name: 'Claim history' }).click();
			await ada.page.waitForURL(/\/rewards\/history$/);
			await expect(ada.page.getByText('Claimed by you')).toBeVisible();
		} finally {
			await ada.close();
			await jun.close();
		}
	});
});
