import { expect, type Page } from '@playwright/test';

/**
 * Shared steps for the invite flows.
 *
 * Text inputs go through `fillWaInput` because the app's fields are
 * `<wa-input>` custom elements from Web Awesome: the thing a user types into is
 * a plain `<input>` inside the element's shadow root, and only the custom
 * element carries the `name`. Playwright's selector engine pierces open shadow
 * roots, so `wa-input[name=x] input` reaches it.
 */

export async function fillWaInput(page: Page, name: string, value: string) {
	await page.locator(`wa-input[name="${name}"] input`).first().fill(value);
}

let accountCounter = 0;

/** A fresh email per call, so a rerun inside one database cannot collide. */
export function uniqueEmail(prefix: string): string {
	accountCounter += 1;
	return `${prefix}-${Date.now()}-${accountCounter}@example.test`;
}

export type Account = { name: string; email: string; password: string };

export function account(name: string): Account {
	return { name, email: uniqueEmail(name.toLowerCase()), password: 'correct-horse-battery' };
}

export async function signUp(page: Page, who: Account, from = '/signup') {
	await page.goto(from);
	await fillWaInput(page, 'name', who.name);
	await fillWaInput(page, 'email', who.email);
	await fillWaInput(page, 'password', who.password);
	await fillWaInput(page, 'passwordConfirm', who.password);
	await page.getByRole('button', { name: 'Sign Up' }).click();
	// Waits for the form to be left behind rather than for a fixed destination:
	// signing up lands on /home normally and back on the invite when one is
	// being accepted. Without this the next step races the session cookie.
	await page.waitForURL((url) => !url.pathname.startsWith('/signup'));
}

export async function logIn(page: Page, who: Account, from = '/login') {
	await page.goto(from);
	await fillWaInput(page, 'email', who.email);
	await fillWaInput(page, 'password', who.password);
	await page.getByRole('button', { name: 'Login' }).click();
	// See the note in signUp: the destination depends on `redirectTo`.
	await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

export async function logOut(page: Page) {
	await page.goto('/settings');
	await page.getByRole('button', { name: 'Log out' }).click();
	// The literal path, not a '**/' glob: Playwright resolves a relative glob
	// against baseURL, and the resulting '**/' pattern never matches a bare '/'.
	await page.waitForURL('/');
}

/** Walks the add-a-partner flow and returns the invite URL it produced. */
export async function createInvite(
	page: Page,
	answers: { partnerName: string; yourName: string; label?: string; control: 'me' | 'them' | 'mix' }
): Promise<string> {
	await page.goto('/settings/partners');
	await page.getByRole('link', { name: 'Add' }).click();
	await page.waitForURL('**/settings/partners/new');

	await fillWaInput(page, 'partnerName', answers.partnerName);
	await fillWaInput(page, 'yourName', answers.yourName);
	if (answers.label) await fillWaInput(page, 'relationshipLabel', answers.label);
	await page.locator(`input[name="control"][value="${answers.control}"]`).check();

	await page.getByRole('button', { name: 'Create invite link' }).click();
	// The action returns the link instead of redirecting, and the page navigates
	// itself once the share sheet has been offered.
	await page.waitForURL(/\/settings\/partners\/[0-9a-f-]{36}$/);

	const link = await page.getByLabel('Invite link').inputValue();
	expect(link).toMatch(/\/invite\//);
	return link;
}

/** The labels of the bottom nav's tabs, in order. */
export async function navTabs(page: Page): Promise<string[]> {
	const nav = page.getByRole('navigation', { name: 'Primary' });
	await expect(nav).toBeVisible();
	return (await nav.getByRole('link').allTextContents()).map((text) => text.trim());
}
