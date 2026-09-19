import { expect, type Browser, type Locator, type Page } from '@playwright/test';

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

/**
 * Fills a password box.
 *
 * Separate from `fillWaInput` because the password inputs deliberately carry no
 * `name` — see `PasswordField.svelte`: a named input is in the submitted
 * FormData whether or not any JavaScript ran, and the whole point of the
 * client-side KDF is that the plaintext password is never posted. They carry
 * `data-field` instead, purely so this locator has something to match.
 *
 * Not `getByLabel('Password')`, which is ambiguous against "Confirm password".
 */
export async function fillPassword(page: Page, field: string, value: string) {
	await page.locator(`wa-input[data-field="${field}"] input`).first().fill(value);
}

/**
 * Clicks a Web Awesome button, once it can actually do anything.
 *
 * `<wa-button type="submit">` only submits its form after Web Awesome has
 * upgraded the element; before that it is an unknown tag and a click on it is
 * silently a no-op. Playwright's actionability checks do not catch this — the
 * element is present, visible and stable — so the symptom is a test that hangs
 * with **no request made at all**, which is a genuinely confusing thing to
 * debug.
 *
 * Filling a `<wa-input>` first is not enough of a guarantee: under `vite dev`
 * every component is a separate module request, so `input.js` routinely lands
 * before `button.js`. A production build puts them in one bundle, so this is a
 * dev-only race — but the suite runs against `vite dev`, and it reproduced
 * about half the time on a fast machine.
 *
 * Waiting on the custom element registry is the precise check: it is exactly
 * the condition that makes the click meaningful.
 */
export async function clickWaButton(page: Page, name: string) {
	await page.waitForFunction(() => customElements.get('wa-button') !== undefined);
	await page.getByRole('button', { name }).click();
}

/**
 * Waits until a superforms-enhanced form is live, BEFORE touching its fields.
 *
 * This has to happen before the first `fill`, not just before the submit, and
 * that ordering is the whole point. `InputField.svelte` renders each field's
 * `value` from superforms' `$form`, so when Svelte hydrates it writes the
 * store's value — an empty string on a fresh form — over whatever is in the
 * DOM. Anything typed before hydration is therefore silently erased.
 *
 * The failure that produced is worth describing, because nothing about it
 * points at the cause: filling email, then password, then clicking submit would
 * intermittently leave the *email* box empty (hydration landed between the two
 * fills), native constraint validation then refused to submit a required-but-
 * empty field, and the test hung for its full timeout with no request made and
 * no error anywhere. About one full-suite run in two on a fast machine.
 *
 * `data-ready` is set from `onMount` in `LoginForm.svelte` and
 * `SignupForm.svelte`, so it means exactly "the client has taken over". Cheaper
 * signals are all insufficient: the elements are present, visible and stable
 * long before then, and even `customElements.get('wa-button')` can resolve
 * while Svelte has yet to attach anything.
 *
 * NOTE: only those two forms carry the marker. The other superforms screens
 * (the partner forms) have the same latent race — they use the same
 * `InputField` — but have not been seen to lose it. Worth adding the marker
 * there if one ever starts flaking.
 */
export async function waitForEnhancedForm(page: Page) {
	await page.locator('form[data-ready]').first().waitFor();
}

/** Submits a form whose behaviour lives in `use:superform.enhance`. */
export async function submitEnhancedForm(page: Page, buttonName: string) {
	await waitForEnhancedForm(page);
	await clickWaButton(page, buttonName);
}

let accountCounter = 0;

/** A fresh email per call, so a rerun inside one database cannot collide. */
export function uniqueEmail(prefix: string): string {
	accountCounter += 1;
	return `${prefix}-${Date.now()}-${accountCounter}@example.test`;
}

export type Account = { name: string; email: string; password: string };

export function account(name: string): Account {
	// 21 characters, comfortably over the 12-character minimum the signup form
	// now enforces client-side — the password also protects message history, so
	// the floor went up. A shorter fixture would be rejected before submitting.
	return { name, email: uniqueEmail(name.toLowerCase()), password: 'correct-horse-battery' };
}

export async function signUp(page: Page, who: Account, from = '/signup') {
	await page.goto(from);
	// Before the first fill, not just before the submit — see the note on
	// waitForEnhancedForm. Hydration overwrites fields typed ahead of it.
	await waitForEnhancedForm(page);
	await fillWaInput(page, 'name', who.name);
	await fillWaInput(page, 'email', who.email);
	await fillPassword(page, 'password', who.password);
	await fillPassword(page, 'passwordConfirm', who.password);
	await submitEnhancedForm(page, 'Sign Up');
	// Waits for the form to be left behind rather than for a fixed destination:
	// signing up lands on /home normally and back on the invite when one is
	// being accepted. Without this the next step races the session cookie.
	await page.waitForURL((url) => !url.pathname.startsWith('/signup'));
}

export async function logIn(page: Page, who: Account, from = '/login') {
	await page.goto(from);
	await waitForEnhancedForm(page);
	await fillWaInput(page, 'email', who.email);
	await fillPassword(page, 'password', who.password);
	await submitEnhancedForm(page, 'Login');
	// See the note in signUp: the destination depends on `redirectTo`.
	await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

export async function logOut(page: Page) {
	await page.goto('/settings');
	await clickWaButton(page, 'Log out');
	// The literal path, not a '**/' glob: Playwright resolves a relative glob
	// against baseURL, and the resulting '**/' pattern never matches a bare '/'.
	await page.waitForURL('/');
}

/** Walks the add-a-partner flow and returns the invite URL it produced. */
export async function createInvite(
	page: Page,
	answers: {
		partnerName: string;
		yourName: string;
		partnerRole?: string;
		yourRole?: string;
		control: 'me' | 'them' | 'mix';
	}
): Promise<string> {
	await page.goto('/settings/partners');
	await page.getByRole('link', { name: 'Add' }).click();
	await page.waitForURL('**/settings/partners/new');

	await fillWaInput(page, 'partnerName', answers.partnerName);
	await fillWaInput(page, 'yourName', answers.yourName);
	if (answers.partnerRole) await fillWaInput(page, 'partnerRole', answers.partnerRole);
	if (answers.yourRole) await fillWaInput(page, 'yourRole', answers.yourRole);
	await page.locator(`input[name="control"][value="${answers.control}"]`).check();

	await clickWaButton(page, 'Create invite link');
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

export type Side = { page: Page; who: Account; close: () => Promise<void> };

/**
 * One of the two people, in their own browser context.
 *
 * Separate contexts rather than one page signing in and out, so the two
 * accounts hold genuinely separate session cookies — a single context would
 * pass while hiding a cookie bug.
 *
 * Clipboard permission is granted explicitly: the invite screens call
 * `navigator.clipboard.writeText`, and without it Chromium leaves that promise
 * pending rather than rejecting, which stalls the page waiting to navigate.
 */
export async function newSide(browser: Browser, name: string): Promise<Side> {
	const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
	const page = await context.newPage();
	return { page, who: account(name), close: () => context.close() };
}

/** Links two signed-up accounts, leaving both on their own home page. */
export async function linkAccounts(inviter: Side, invitee: Side): Promise<void> {
	const link = await createInvite(inviter.page, {
		partnerName: invitee.who.name,
		yourName: inviter.who.name,
		control: 'mix'
	});
	await invitee.page.goto(link);
	await clickWaButton(invitee.page, 'Accept and link');
	await invitee.page.waitForURL(/\/partner\//);
}

/**
 * Opens a partner's board, clearing the one-time history warning if it shows.
 *
 * The warning blocks the board until acknowledged, deliberately, so every test
 * that wants the board has to get past it once per account.
 */
export async function openBoard(page: Page, partnerName: string): Promise<void> {
	// Scoped to the nav and matched loosely on purpose: the tab's accessible
	// name is the partner's name TWICE ("Jun Jun"), because the avatar carries a
	// label and the visible span repeats it. An exact match finds nothing.
	await page
		.getByRole('navigation', { name: 'Primary' })
		.getByRole('link', { name: partnerName })
		.click();
	await page.waitForURL(/\/partner\/[0-9a-f-]{36}$/);
	// A LINK, not a button: `<wa-button href=…>` renders an anchor, so
	// getByRole('button') finds nothing. Same for any other wa-button with an
	// href.
	await page.getByRole('link', { name: 'Messages' }).click();
	await page.waitForURL(/\/messages$/);

	const warning = page.getByText(/Your password is the only key/);
	if (await warning.isVisible().catch(() => false)) {
		await page.getByRole('checkbox').check();
		await clickWaButton(page, 'Start messaging');
		await expect(warning).toBeHidden();
	}
}

/**
 * Replies in an open thread.
 *
 * The enabled assertion is the point: Send is disabled while the composer has
 * nothing, so if the typing never reached the component's state the click is a
 * silent no-op and the failure surfaces much later, somewhere else, as a
 * missing message.
 */
export async function reply(page: Page, text: string): Promise<void> {
	await fillRichText(page, text);
	await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled();
	await clickWaButton(page, 'Send');
	// Waits for the send to actually land. The composer is cleared only after
	// `send` resolves, so an empty surface is the signal that the round trip
	// finished.
	//
	// This is not belt and braces. The composer is a `contenteditable` div now,
	// so its contents are real text in the page — `getByText('…')` right after a
	// send matches the *composer* and passes before the message exists, and the
	// failure then lands on the other side's assertion, several steps away. A
	// `<textarea>` never had that problem because its value is not page text.
	await expect(page.locator('.richtext-editor .surface').first()).toHaveText('');
}

/** Writes a new thread and waits for the thread page it lands on. */
export async function writeThread(page: Page, text: string): Promise<void> {
	await clickWaButton(page, 'Write something');
	await fillRichText(page, text);
	// Asserted rather than assumed. The send button is disabled while there is
	// nothing to send, so if the fill did not reach the component's state the
	// next click is a silent no-op and the failure surfaces 90 seconds later as
	// a navigation timeout with no clue attached.
	await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled();
	await clickWaButton(page, 'Send');
	await page.waitForURL(/\/messages\/[0-9a-f-]{36}$/);
}

/**
 * Types into a rich-text editor one key at a time, as a person does.
 *
 * Deliberately NOT `fill()`. `fill()` is a single bulk insertion, so it cannot
 * catch anything that goes wrong *between* keystrokes — and an editor that is
 * torn down and rebuilt on every change looks perfectly healthy to it while
 * dropping every character after the first for a real user.
 *
 * `scope` is a page, or a locator when a screen has more than one editor.
 */
export async function typeRichText(scope: Page | Locator, value: string): Promise<void> {
	const surface = await readyRichText(scope);
	await surface.pressSequentially(value, { delay: 15 });
}

/**
 * Waits for an editor to be interactive, then focuses it.
 *
 * The surface is only `contenteditable` once Lexical has attached — before
 * that it is server-rendered markup with nothing behind it. Typing into that
 * window silently loses characters, so every helper goes through here rather
 * than clicking whatever is on screen.
 */
async function readyRichText(scope: Page | Locator): Promise<Locator> {
	const surface = scope.locator('.richtext-editor .surface[contenteditable="true"]').first();
	await surface.click();
	await expect(surface).toBeFocused();
	return surface;
}

/**
 * Types into a rich-text editor.
 *
 * Every multi-line freetext field in the app is a Lexical editor now — a plain
 * `contenteditable` div, not a `<textarea>` and not inside a shadow root. The
 * click matters: Lexical only builds its initial selection once the surface has
 * focus, and `fill()` on an unfocused contenteditable leaves the document
 * untouched, which surfaces much later as a disabled Send button.
 *
 * `scope` is a page, or a locator when a screen has more than one editor.
 */
export async function fillRichText(scope: Page | Locator, value: string): Promise<void> {
	const surface = await readyRichText(scope);
	await surface.fill(value);
	await expect(surface).toContainText(value);
}

/**
 * Fills a password box the way a password manager extension does.
 *
 * Reproduces a real bug rather than an imagined one, so the mechanism matters.
 * An extension cannot type; it sets `input.value` on the native control and
 * dispatches its own events to tell the page. Those events are untrusted and,
 * critically, `new Event('input', { bubbles: true })` defaults to
 * **`composed: false`** — so it bubbles *inside* `<wa-input>`'s shadow root,
 * where the element's own listener updates its value, and then stops dead at
 * the shadow boundary without ever reaching the host that Svelte listens on.
 *
 * Measured against Web Awesome 3, `vite dev`, Chromium: of the five ways a
 * value can arrive, real typing and a `composed: true` synthetic event reach
 * Svelte, while this one, a silent `input.value =`, and setting the host's own
 * `value` property all leave the component's state empty. Chrome's own autofill
 * dispatches trusted composed events and is therefore fine, which is why this
 * only reproduces with an extension.
 *
 * There is no lower level that can test this. jsdom never upgrades a `wa-*`
 * element, so there is no shadow root and no boundary to fail to cross — a
 * component test would have to stub the very behaviour under test.
 */
export async function autofillPassword(page: Page, field: string, value: string) {
	await autofillWaInput(page, `wa-input[data-field="${field}"]`, value);
}

/**
 * The same fill, addressed by `name` — for the username box beside it.
 *
 * A manager fills both halves of a login, so a test that only fills the
 * password is not reproducing what actually happens. Split out rather than
 * folded in because the password boxes deliberately have no `name` and these
 * do.
 */
export async function autofillWaInput(page: Page, selector: string, value: string) {
	// The shadow root only exists once Web Awesome has upgraded the element, and
	// an extension would likewise have nothing to fill before then.
	await page.waitForFunction(
		(sel) => document.querySelector(sel)?.shadowRoot?.querySelector('input') != null,
		selector
	);
	await page.evaluate(
		({ sel, text }) => {
			const input = document.querySelector(sel)!.shadowRoot!.querySelector('input')!;
			input.value = text;
			input.dispatchEvent(new Event('input', { bubbles: true }));
			input.dispatchEvent(new Event('change', { bubbles: true }));
		},
		{ sel: selector, text: value }
	);
}

/**
 * The same, but with no events at all — the most hostile fill we tolerate.
 *
 * No real manager does this, because it would break every framework that binds
 * on input. It is here because it is the case that decides *where* the value is
 * read from: the host element's own `value` property is still stale afterwards,
 * so only the inner native control is authoritative.
 */
export async function autofillPasswordSilently(page: Page, field: string, value: string) {
	const selector = `wa-input[data-field="${field}"]`;
	await page.waitForFunction(
		(sel) => document.querySelector(sel)?.shadowRoot?.querySelector('input') != null,
		selector
	);
	await page.evaluate(
		({ sel, text }) => {
			document.querySelector(sel)!.shadowRoot!.querySelector('input')!.value = text;
		},
		{ sel: selector, text: value }
	);
}
