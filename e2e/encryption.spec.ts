import { expect, test } from '@playwright/test';
import { createClient } from '@libsql/client';
import {
	account,
	clickWaButton,
	fillPassword,
	fillWaInput,
	logIn,
	logOut,
	signUp,
	submitEnhancedForm,
	waitForEnhancedForm
} from './helpers';

/**
 * The client-side key derivation, over HTTP, in a real browser.
 *
 * This is the only level that can check the property the whole design rests
 * on: that the password is turned into a key in the browser and the plaintext
 * never reaches the server. Everything below the browser is covered by unit
 * tests; the wiring between superforms, the form action and Better Auth is
 * only real here.
 */

/** The database the Playwright web server rebuilt for this run. */
function db() {
	return createClient({ url: 'file:e2e.db' });
}

test.describe('the password never leaves the browser', () => {
	/**
	 * THE test. Superforms' `onSubmit` mutating the FormData before `enhance`
	 * dispatches is an implementation detail rather than a documented contract,
	 * so if a future version stops awaiting the handler, the form would quietly
	 * start posting an empty `authSecret` — or, far worse, a future refactor
	 * could give the password input a `name` again and post the plaintext.
	 *
	 * Both failures are caught here and nowhere else.
	 */
	test('signing up posts a derived secret and never the password itself', async ({ page }) => {
		const who = account('Vera');
		const bodies: string[] = [];

		page.on('request', (request) => {
			if (request.method() !== 'POST') return;
			const body = request.postData();
			if (body) bodies.push(body);
		});

		await signUp(page, who);
		await page.waitForURL('**/home');

		expect(bodies.length).toBeGreaterThan(0);
		const posted = bodies.join('\n');

		// The plaintext password, in any form.
		expect(posted).not.toContain(who.password);
		expect(posted).not.toContain(encodeURIComponent(who.password));
		// And a 43-character base64url auth secret did go.
		expect(posted).toMatch(/authSecret=[A-Za-z0-9_-]{43}/);
	});

	test('logging in posts a derived secret and never the password itself', async ({ page }) => {
		const who = account('Wren');
		await signUp(page, who);
		await logOut(page);

		const bodies: string[] = [];
		page.on('request', (request) => {
			if (request.method() === 'POST') {
				const body = request.postData();
				if (body) bodies.push(body);
			}
		});

		await logIn(page, who);
		await page.waitForURL('**/home');

		const posted = bodies.join('\n');
		expect(posted).not.toContain(who.password);
		expect(posted).toMatch(/authSecret=[A-Za-z0-9_-]{43}/);
	});

	/**
	 * The password input carries no `name`, which is what makes the above true
	 * even if the KDF throws. Asserted directly, because it is a one-word edit
	 * away from being wrong and nothing else would notice.
	 */
	test('the password inputs are not named, so they cannot be submitted', async ({ page }) => {
		await page.goto('/signup');
		const boxes = page.locator(
			'wa-input[data-field="password"], wa-input[data-field="passwordConfirm"]'
		);
		await expect(boxes).toHaveCount(2);
		for (const name of await boxes.evaluateAll((els) => els.map((el) => el.getAttribute('name')))) {
			expect(name).toBeNull();
		}
	});
});

test.describe('what signing up stores', () => {
	/**
	 * The server should end up holding a public recipient and a wrap it cannot
	 * open — and nothing that looks like a password.
	 *
	 * Reads `e2e.db` directly because there is no UI for keys yet. That is a
	 * deliberate seam in this one spec: it asserts the shape of what was
	 * persisted, which no other level can see end to end.
	 */
	test('stores a public recipient and one sealed wrap', async ({ page }) => {
		const who = account('Xanthe');
		await signUp(page, who);
		await page.waitForURL('**/home');

		const client = db();
		try {
			const keys = await client.execute({
				sql: `select k.recipient, k.history_warning_ack_at
				      from user_keys k join user u on u.id = k.user_id where u.email = ?`,
				args: [who.email]
			});
			expect(keys.rows).toHaveLength(1);
			expect(String(keys.rows[0].recipient)).toMatch(/^age1[02-9ac-hj-np-z]{58}$/);
			// The history warning has not been acknowledged yet — that happens on
			// the messaging page, not at signup.
			expect(keys.rows[0].history_warning_ack_at).toBeNull();

			const wraps = await client.execute({
				sql: `select w.type, w.params, w.blob
				      from user_key_wraps w join user u on u.id = w.user_id where u.email = ?`,
				args: [who.email]
			});
			expect(wraps.rows).toHaveLength(1);
			expect(wraps.rows[0].type).toBe('password');
			expect(JSON.parse(String(wraps.rows[0].params))).toMatchObject({
				type: 'password',
				kdf: 'PBKDF2-SHA256'
			});
			// Opaque, and — the point — not the password.
			expect(String(wraps.rows[0].blob)).toMatch(/^[A-Za-z0-9_-]+$/);
			expect(String(wraps.rows[0].blob)).not.toContain(who.password);

			// Better Auth's stored credential is a scrypt hash of the auth secret,
			// so it must not be the auth secret itself and must not be the password.
			const creds = await client.execute({
				sql: `select a.password from account a join user u on u.id = a.user_id
				      where u.email = ? and a.provider_id = 'credential'`,
				args: [who.email]
			});
			expect(creds.rows).toHaveLength(1);
			expect(String(creds.rows[0].password)).not.toContain(who.password);
			// scrypt output is `salt:hash`, both hex.
			expect(String(creds.rows[0].password)).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
		} finally {
			client.close();
		}
	});
});

test.describe('honest degradation', () => {
	/**
	 * With no JavaScript there is no key, so there is nothing for the server to
	 * check — and the page says so instead of failing in a way that looks like a
	 * wrong password.
	 *
	 * Worth being precise about what this does and does not prove. The form was
	 * ALREADY unusable without JavaScript before the client-side KDF existed,
	 * and not because of it: every text field is a `<wa-input>` custom element
	 * whose real `<input>` lives in a shadow root that only exists once Web
	 * Awesome upgrades it. With scripting off there are no text inputs on the
	 * page at all — asserted below — so there was never a working no-JS sign-in
	 * to lose. The `<noscript>` block explains a dead end that predates this
	 * change rather than announcing a new one.
	 */
	test('explains itself when JavaScript is off', async ({ browser }) => {
		const context = await browser.newContext({ javaScriptEnabled: false });
		const page = await context.newPage();
		try {
			await page.goto('/login');
			await expect(page.getByText(/Signing in needs JavaScript/)).toBeVisible();

			// The pre-existing dead end: the custom elements are in the markup but
			// never upgrade, so the only real input is the hidden authSecret field.
			await expect(page.locator('form wa-input')).toHaveCount(2);
			await expect(page.locator('form wa-input input')).toHaveCount(0);
			await expect(page.locator('form input:not([type=hidden])')).toHaveCount(0);

			// Nothing was signed in, and nothing could be.
			expect(new URL(page.url()).pathname).toBe('/login');
		} finally {
			await context.close();
		}
	});

	// The existing rule, still holding after the change: a wrong email and a
	// wrong password must be indistinguishable. They now genuinely are, because
	// a wrong email derives a different auth secret.
	test('does not reveal which half of the credentials was wrong', async ({ page }) => {
		const who = account('Yorick');
		await signUp(page, who);
		await logOut(page);

		const message = /Invalid email or password/;

		await page.goto('/login');
		await waitForEnhancedForm(page);
		await fillWaInput(page, 'email', who.email);
		await fillPassword(page, 'password', 'definitely-not-the-password');
		await submitEnhancedForm(page, 'Login');
		await expect(page.getByText(message)).toBeVisible();

		await page.goto('/login');
		await waitForEnhancedForm(page);
		await fillWaInput(page, 'email', 'nobody-at-all@example.test');
		await fillPassword(page, 'password', who.password);
		await submitEnhancedForm(page, 'Login');
		await expect(page.getByText(message)).toBeVisible();
	});
});

test.describe('password strength', () => {
	/**
	 * Strength is now checked only in the browser — the server sees a
	 * fixed-length derived value and cannot tell a passphrase from one
	 * character. So the check has to actually stop the submit, and the way to
	 * prove that is that no request was made at all.
	 */
	test('refuses a short password without asking the server', async ({ page }) => {
		let posts = 0;
		page.on('request', (request) => {
			if (request.method() === 'POST') posts += 1;
		});

		const who = account('Zadie');
		await page.goto('/signup');
		await waitForEnhancedForm(page);
		await fillWaInput(page, 'name', who.name);
		await fillWaInput(page, 'email', who.email);
		await fillPassword(page, 'password', 'short');
		await fillPassword(page, 'passwordConfirm', 'short');
		await submitEnhancedForm(page, 'Sign Up');

		await expect(page.getByText(/at least 12 characters/)).toBeVisible();
		expect(posts).toBe(0);
		expect(new URL(page.url()).pathname).toBe('/signup');
	});

	test('refuses a mismatched confirmation without asking the server', async ({ page }) => {
		let posts = 0;
		page.on('request', (request) => {
			if (request.method() === 'POST') posts += 1;
		});

		const who = account('Ansel');
		await page.goto('/signup');
		await waitForEnhancedForm(page);
		await fillWaInput(page, 'name', who.name);
		await fillWaInput(page, 'email', who.email);
		await fillPassword(page, 'password', who.password);
		await fillPassword(page, 'passwordConfirm', `${who.password}-different`);
		await submitEnhancedForm(page, 'Sign Up');

		await expect(page.getByText(/Passwords don't match/)).toBeVisible();
		expect(posts).toBe(0);
	});
});

test.describe('getting your keys back', () => {
	/**
	 * The point of storing a copy on the server: a second device can catch up.
	 *
	 * Signing in derives the wrap key from the password that was just typed, so
	 * this should happen with no extra prompt at all — the password has already
	 * been given.
	 */
	test('a new device unlocks straight away after signing in', async ({ browser }) => {
		const who = account('Bo');

		const first = await browser.newContext();
		try {
			await signUp(await first.newPage(), who);
		} finally {
			await first.close();
		}

		// A genuinely separate device: new context, so no IndexedDB and no cookies.
		const second = await browser.newContext();
		try {
			const page = await second.newPage();
			await logIn(page, who);
			await page.goto('/settings/encryption');
			await expect(page.getByText(/Your messages are unlocked here/)).toBeVisible();
		} finally {
			await second.close();
		}
	});

	/**
	 * The cold path, which is the one a real user hits most: still signed in,
	 * but the browser has thrown away its storage. iOS does this after about a
	 * week of not opening the app.
	 *
	 * Simulated by carrying the session cookie into a fresh context, which
	 * leaves the session valid and the key cache empty — exactly the state
	 * eviction produces.
	 */
	test('a cleared browser asks for the password once, then unlocks', async ({ browser }) => {
		const who = account('Cleo');

		const first = await browser.newContext();
		let cookies;
		try {
			await signUp(await first.newPage(), who);
			cookies = await first.cookies();
		} finally {
			await first.close();
		}

		const evicted = await browser.newContext();
		try {
			await evicted.addCookies(cookies);
			const page = await evicted.newPage();
			await page.goto('/settings/encryption');

			// Signed in, but locked — and said so as an ordinary state.
			await expect(page.getByText(/Locked on this device/)).toBeVisible();

			await fillPassword(page, 'unlockPassword', who.password);
			await clickWaButton(page, 'Unlock messages');
			await expect(page.getByText(/Your messages are unlocked here/)).toBeVisible();
		} finally {
			await evicted.close();
		}
	});

	// The unlock happens against the stored wrap on the device, so a wrong
	// password is answered locally and instantly, with no request at all.
	test('rejects a wrong password locally, without asking the server', async ({ browser }) => {
		const who = account('Dov');

		const first = await browser.newContext();
		let cookies;
		try {
			await signUp(await first.newPage(), who);
			cookies = await first.cookies();
		} finally {
			await first.close();
		}

		const evicted = await browser.newContext();
		try {
			await evicted.addCookies(cookies);
			const page = await evicted.newPage();
			let posts = 0;
			page.on('request', (request) => {
				if (request.method() === 'POST') posts += 1;
			});

			await page.goto('/settings/encryption');
			await expect(page.getByText(/Locked on this device/)).toBeVisible();

			await fillPassword(page, 'unlockPassword', 'not-the-right-password');
			await clickWaButton(page, 'Unlock messages');
			await expect(page.getByText(/did not unlock your messages/)).toBeVisible();
			expect(posts).toBe(0);
		} finally {
			await evicted.close();
		}
	});

	/**
	 * Changing a password re-seals the same identity, so nothing is lost. The
	 * observable consequence: the new password unlocks a cleared browser and the
	 * old one does not.
	 */
	test('a changed password becomes the one that unlocks', async ({ browser }) => {
		const who = account('Esme');
		const newPassword = 'vocalist-hazy-radar-plunge';

		const first = await browser.newContext();
		let cookies;
		try {
			const page = await first.newPage();
			await signUp(page, who);
			await page.goto('/settings/encryption');

			await fillPassword(page, 'oldPassword', who.password);
			await fillPassword(page, 'newPassword', newPassword);
			await fillPassword(page, 'newConfirm', newPassword);
			await clickWaButton(page, 'Change password');
			// The form clears itself once the action has come back.
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
});
