import { expect, test } from './fixtures';
import { clickWaButton, createInvite, newSide, signUp } from './helpers';

test.describe('tasks', () => {
	test('a user can manage and complete self tasks from home', async ({ browser }) => {
		const ada = await newSide(browser, 'Ada');

		try {
			await signUp(ada.page, ada.who);
			await ada.page.waitForURL('**/home');
			await ada.page.getByRole('link', { name: 'Tasks' }).click();
			await ada.page.waitForURL(/\/home\/tasks$/);

			await ada.page.getByRole('link', { name: 'Add a task' }).click();
			await ada.page.waitForURL(/\/home\/tasks\/add$/);
			await ada.page.locator('input[name="title"]').fill('Long shower');
			await ada.page.locator('textarea[name="description"]').fill('Take your time');
			await ada.page.locator('input[name="creditsAwarded"]').fill('2');
			await ada.page.locator('textarea[name="completionMessagesText"]').fill('Nicely done');
			await clickWaButton(ada.page, 'Add task');
			await ada.page.waitForURL(/\/home\/tasks$/);

			await expect(ada.page.getByRole('heading', { name: 'Long shower' })).toBeVisible();
			await clickWaButton(ada.page, 'Complete');
			await expect(ada.page.getByRole('heading', { name: 'Long shower' })).toBeVisible();

			await ada.page.goto('/home/rewards');
			await expect(ada.page.locator('.self .title-row')).toContainText('Credits: 2');
		} finally {
			await ada.close();
		}
	});

	test('the controlling side can create a partner task and the other side can complete it', async ({
		browser
	}) => {
		const ada = await newSide(browser, 'Ada');
		const jun = await newSide(browser, 'Jun');

		try {
			await signUp(ada.page, ada.who);
			await ada.page.waitForURL('**/home');
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

			await jun.page.getByRole('link', { name: 'Tasks' }).click();
			await jun.page.waitForURL(/\/tasks$/);
			await jun.page.getByRole('link', { name: 'Add a task' }).click();
			await jun.page.waitForURL(/\/tasks\/add$/);
			await jun.page.locator('input[name="title"]').fill('Make tea');
			await jun.page.locator('textarea[name="description"]').fill('With the good teapot');
			await jun.page.locator('input[name="creditsAwarded"]').fill('3');
			await jun.page.locator('textarea[name="completionMessagesText"]').fill('Perfect');
			await clickWaButton(jun.page, 'Add task');
			await jun.page.waitForURL(/\/tasks$/);
			await expect(jun.page.getByRole('heading', { name: 'Make tea' })).toBeVisible();

			await ada.page.goto('/home/tasks');
			await expect(ada.page.locator('.partner-sections')).toContainText("Jun's Tasks");
			await clickWaButton(ada.page, 'Complete');
			await expect(ada.page.getByText('Task completed.')).toBeVisible();

			await ada.page.getByRole('link', { name: 'Open full task list' }).click();
			await ada.page.waitForURL(/\/partner\/[0-9a-f-]{36}\/tasks$/);
			await expect(ada.page.getByRole('heading', { name: 'Make tea' })).toBeVisible();
			await ada.page.getByRole('link', { name: 'Completion History' }).click();
			await ada.page.waitForURL(/\/partner\/[0-9a-f-]{36}\/tasks\/history$/);
			await expect(ada.page.getByText('Completed by you')).toBeVisible();

			await ada.page.getByRole('link', { name: 'Back to tasks' }).click();
			await ada.page.waitForURL(/\/partner\/[0-9a-f-]{36}\/tasks$/);
			await ada.page.getByRole('link', { name: 'Back to partner' }).click();
			await ada.page.waitForURL(/\/partner\/[0-9a-f-]{36}$/);
			await ada.page.getByRole('link', { name: 'Rewards' }).click();
			await ada.page.waitForURL(/\/rewards$/);
			await expect(ada.page.locator('.title-row').first()).toContainText('3');
		} finally {
			await ada.close();
			await jun.close();
		}
	});
});
