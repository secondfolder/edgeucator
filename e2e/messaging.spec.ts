import { Buffer } from 'node:buffer';
import { expect, test } from './fixtures';
import {
	clickWaButton,
	fillRichText,
	reply,
	linkAccounts,
	newSide,
	openBoard,
	signUp,
	writeThread
} from './helpers';

/**
 * Encrypted messages between two partners, over HTTP, in two real browsers.
 *
 * This is the only level that can prove the thing the whole feature is for:
 * that what one person types, the other person reads, having travelled through
 * a server that could not read it. Everything below here is unit-tested; the
 * round trip is only real in a browser.
 *
 * Two contexts, so the two accounts hold genuinely separate sessions and
 * genuinely separate key caches.
 */
test.describe('a message between partners', () => {
	test('travels end to end, and comes back readable', async ({ browser }) => {
		const ada = await newSide(browser, 'Ada');
		const jun = await newSide(browser, 'Jun');
		const secret = 'meet me in the kitchen at eleven';

		try {
			await signUp(ada.page, ada.who);
			await signUp(jun.page, jun.who);
			await linkAccounts(ada, jun);

			// ── Ada writes ──────────────────────────────────────────────────────
			await ada.page.goto('/home');
			await openBoard(ada.page, 'Jun');
			await expect(ada.page.getByText(/Nothing here yet/)).toBeVisible();

			await writeThread(ada.page, secret);
			// She is in the thread she just started, and can read her own message.
			await expect(ada.page.getByText(secret)).toBeVisible();

			// ── Jun is told ─────────────────────────────────────────────────────
			await jun.page.goto('/home');
			const link = jun.page.getByRole('link', { name: /1 new message from Ada/ });
			await expect(link).toBeVisible();

			// ── Jun reads it ────────────────────────────────────────────────────
			await link.click();
			await jun.page.waitForURL(/\/messages$/);
			// Past the one-time warning, then the unopened envelope Jun sees.
			await jun.page.getByRole('checkbox').check();
			await clickWaButton(jun.page, 'Start messaging');

			const sticker = jun.page.getByRole('link', { name: /^Unread message 1 of 1/ });
			await expect(sticker).toBeVisible();
			await expect(sticker.locator('wa-icon')).toHaveAttribute('name', 'envelope');

			await sticker.click();
			await jun.page.waitForURL(/\/messages\/[0-9a-f-]{36}$/);
			/**
			 * THE assertion. Ada typed this in her browser, it was encrypted there,
			 * stored as ciphertext, and decrypted in Jun's. Nothing else in the
			 * suite proves that.
			 */
			await expect(jun.page.getByText(secret)).toBeVisible();

			// ── and it is no longer unread ──────────────────────────────────────
			await jun.page.goto('/home');
			await expect(jun.page.getByRole('link', { name: /new message from Ada/ })).toBeHidden();
		} finally {
			await ada.close();
			await jun.close();
		}
	});

	test('the server never sees the plaintext', async ({ browser }) => {
		const ada = await newSide(browser, 'Ada');
		const jun = await newSide(browser, 'Jun');
		const secret = 'an extremely distinctive phrase';
		const bodies: string[] = [];

		try {
			await signUp(ada.page, ada.who);
			await signUp(jun.page, jun.who);
			await linkAccounts(ada, jun);

			ada.page.on('request', (request) => {
				if (request.method() === 'POST') {
					const body = request.postData();
					if (body) bodies.push(body);
				}
			});

			await ada.page.goto('/home');
			await openBoard(ada.page, 'Jun');
			await writeThread(ada.page, secret);

			const posted = bodies.join('\n');
			expect(posted).not.toContain(secret);
			expect(posted).not.toContain('distinctive');
			// And something opaque did go.
			expect(posted).toContain('ciphertext');
		} finally {
			await ada.close();
			await jun.close();
		}
	});
});

test.describe('a thread', () => {
	test('takes replies and reactions from both sides', async ({ browser }) => {
		const ada = await newSide(browser, 'Ada');
		const jun = await newSide(browser, 'Jun');

		try {
			await signUp(ada.page, ada.who);
			await signUp(jun.page, jun.who);
			await linkAccounts(ada, jun);

			await ada.page.goto('/home');
			await openBoard(ada.page, 'Jun');
			await writeThread(ada.page, 'are you free tonight');

			// Jun opens the thread and replies.
			await jun.page.goto('/home');
			await openBoard(jun.page, 'Ada');
			await jun.page.getByRole('link', { name: /^Unread message/ }).click();
			await jun.page.waitForURL(/\/messages\/[0-9a-f-]{36}$/);
			await expect(jun.page.getByText('are you free tonight')).toBeVisible();

			await reply(jun.page, 'very');
			await expect(jun.page.getByText('very')).toBeVisible();

			// Ada sees the reply.
			await ada.page.reload();
			await expect(ada.page.getByText('very')).toBeVisible();

			// Ada reacts to Jun's message, and not to her own.
			const bubbles = ada.page.locator('.messages > li');
			await expect(bubbles).toHaveCount(2);
			// Her own bubble offers no reaction control; the requirement is
			// reacting to what you received.
			await expect(bubbles.nth(0).getByRole('button', { name: /reaction/i })).toHaveCount(0);

			await bubbles.nth(1).getByRole('button', { name: 'Add a reaction' }).click();
			await ada.page.getByRole('button', { name: '🔥' }).click();
			await expect(ada.page.getByRole('list', { name: 'Reactions' })).toContainText('🔥');

			// Jun sees the tapback.
			await jun.page.reload();
			await expect(jun.page.getByRole('list', { name: 'Reactions' })).toContainText('🔥');
		} finally {
			await ada.close();
			await jun.close();
		}
	});
});

test.describe('the board', () => {
	test('puts unread first and moves a thread below the seam once read', async ({ browser }) => {
		const ada = await newSide(browser, 'Ada');
		const jun = await newSide(browser, 'Jun');

		try {
			await signUp(ada.page, ada.who);
			await signUp(jun.page, jun.who);
			await linkAccounts(ada, jun);

			// Two threads from Ada, in order.
			await ada.page.goto('/home');
			await openBoard(ada.page, 'Jun');
			await writeThread(ada.page, 'the first one');
			await ada.page.goBack();
			await writeThread(ada.page, 'the second one');

			await jun.page.goto('/home');
			await openBoard(jun.page, 'Ada');

			// Both unread, newest at the top, and no seam yet.
			const unread = jun.page.getByRole('list', { name: 'Unread' });
			await expect(unread.getByRole('listitem')).toHaveCount(2);
			await expect(unread.getByRole('link').first().locator('wa-icon')).toHaveAttribute(
				'name',
				'envelope'
			);
			await expect(jun.page.getByText('Already read')).toBeHidden();

			// Open the newest; it crosses the seam.
			await unread.getByRole('link').first().click();
			await jun.page.waitForURL(/\/messages\/[0-9a-f-]{36}$/);
			await expect(jun.page.getByText('the second one')).toBeVisible();
			await jun.page.goBack();

			await expect(jun.page.getByText('Already read')).toBeVisible();
			await expect(
				jun.page.getByRole('list', { name: 'Unread' }).getByRole('listitem')
			).toHaveCount(1);
			const read = jun.page.getByRole('list', { name: 'Already read' });
			await expect(read.getByRole('listitem')).toHaveCount(1);
			await expect(read.getByText('the second one')).toBeVisible();

			await reply(ada.page, 'and another');
			await expect(ada.page.getByText('and another')).toBeVisible();

			await jun.page.reload();
			const unreadAgain = jun.page.getByRole('list', { name: 'Unread' });
			await expect(unreadAgain.getByRole('listitem')).toHaveCount(2);
			const reopened = unreadAgain.getByRole('listitem').first();
			await expect(reopened.getByText('the second one')).toBeVisible();
			await expect(reopened.locator('wa-icon[name="envelope"]')).toHaveCount(0);
		} finally {
			await ada.close();
			await jun.close();
		}
	});

	test('keeps board tiles aligned in a plain grid and opens the composer only on tap', async ({
		browser
	}) => {
		const ada = await newSide(browser, 'Ada');
		const jun = await newSide(browser, 'Jun');

		try {
			await signUp(ada.page, ada.who);
			await signUp(jun.page, jun.who);
			await linkAccounts(ada, jun);

			await ada.page.goto('/home');
			await openBoard(ada.page, 'Jun');
			const shell = ada.page.locator('wa-dialog.composer-dialog');
			await expect(shell).toHaveCount(0);
			await clickWaButton(ada.page, 'Write something');
			await expect(shell).toHaveCount(1);
			const sizing = await shell.evaluate((element) => {
				const root = element.shadowRoot;
				const body = root?.querySelector<HTMLElement>('[part~="body"]');
				const panel = root?.querySelector<HTMLElement>('[part~="dialog"]');
				const title = root?.querySelector<HTMLElement>('[part~="title"]');
				const composer = element.querySelector<HTMLElement>('.composer');
				if (!body || !panel || !title || !composer) return null;
				const bodyRect = body.getBoundingClientRect();
				const composerRect = composer.getBoundingClientRect();
				const panelRect = panel.getBoundingClientRect();
				return {
					open: element.hasAttribute('open'),
					title: title.textContent?.trim() ?? '',
					bodyWidth: bodyRect.width,
					bodyHeight: bodyRect.height,
					composerWidth: composerRect.width,
					composerHeight: composerRect.height,
					leftGap: panelRect.left,
					rightGap: window.innerWidth - panelRect.right
				};
			});
			expect(sizing).not.toBeNull();
			expect(sizing!.open).toBe(true);
			expect(sizing!.title).toBe('Send to Jun');
			expect(Math.abs(sizing!.composerWidth - sizing!.bodyWidth)).toBeLessThanOrEqual(1);
			expect(Math.abs(sizing!.composerHeight - sizing!.bodyHeight)).toBeLessThanOrEqual(1);
			expect(Math.abs(sizing!.leftGap - sizing!.rightGap)).toBeLessThanOrEqual(8);
			await reply(ada.page, 'one');
			await ada.page.waitForURL(/\/messages\/[0-9a-f-]{36}$/);
			await ada.page.goBack();

			await writeThread(ada.page, 'two');
			await ada.page.goBack();
			await writeThread(ada.page, 'three');
			await ada.page.goBack();

			const tiles = ada.page.locator('ul[aria-label] > li > a');
			await expect(tiles).toHaveCount(3);
			const transforms = await tiles.evaluateAll((els) =>
				els.map((el) => getComputedStyle(el).transform)
			);
			expect(transforms).toEqual(['none', 'none', 'none']);
		} finally {
			await ada.close();
			await jun.close();
		}
	});
});

test.describe('live updates', () => {
	/**
	 * The requirement the whole realtime stage exists for: the other side sees a
	 * message arrive without touching anything.
	 *
	 * Asserted with a retrying `expect` and **never** a `page.reload()` — a
	 * reload would pass whether or not the live feed works at all, which is
	 * exactly the bug this is here to catch. The other messaging tests do reload
	 * on purpose, because they are testing storage and decryption rather than
	 * delivery.
	 *
	 * Runs against `vite dev`, so the notifier behind it is the in-process one in
	 * `server/realtime/local.ts`. That covers the client, the SSE endpoint, the
	 * framing and the `invalidate` wiring; the Durable Object that replaces it in
	 * production is covered directly by `durable-object.test.ts`, since Playwright
	 * does not point at `wrangler dev`.
	 */
	test('a reply appears in an open thread with no reload', async ({ browser }) => {
		const ada = await newSide(browser, 'Ada');
		const jun = await newSide(browser, 'Jun');

		try {
			// Wraps the constructor before any app code runs, and re-installs itself
			// on every document, so the count survives the full page loads earlier in
			// the flow.
			await ada.page.addInitScript(() => {
				const target = window as unknown as { EventSource: unknown; __streams?: number };
				const Real = target.EventSource as {
					new (url: string, eventSourceInitDict?: EventSourceInit): EventSource;
				};
				target.__streams = 0;
				target.EventSource = class extends Real {
					constructor(url: string) {
						super(url);
						target.__streams = (target.__streams ?? 0) + 1;
					}
				};
			});

			await signUp(ada.page, ada.who);
			await signUp(jun.page, jun.who);
			await linkAccounts(ada, jun);

			await ada.page.goto('/home');
			await openBoard(ada.page, 'Jun');
			await writeThread(ada.page, 'thinking about you');
			// Ada is now sitting on the thread she just wrote, and stays there.
			const adaThreadUrl = ada.page.url();

			await jun.page.goto('/home');
			await openBoard(jun.page, 'Ada');
			await jun.page.getByRole('link', { name: /^Unread message/ }).click();
			await jun.page.waitForURL(/\/messages\/[0-9a-f-]{36}$/);
			// How many streams Ada's page has opened so far. Counted by wrapping the
			// constructor before any app code runs.
			const streamsBefore = await ada.page.evaluate(
				() => (window as unknown as { __streams?: number }).__streams ?? 0
			);

			await reply(jun.page, 'come over');
			await expect(jun.page.getByText('come over')).toBeVisible();

			// No reload, no navigation, no interaction of any kind.
			await expect(ada.page.getByText('come over')).toBeVisible({ timeout: 20_000 });
			expect(ada.page.url()).toBe(adaThreadUrl);

			/**
			 * A delivered event must NOT cost a reconnect.
			 *
			 * The subscription lives in an `$effect` that reads `data`, and
			 * `invalidate()` reassigns `data` — so unless the effect depends on the
			 * partnership *id* rather than the whole prop, every arriving message
			 * tears the stream down and opens a new one. That still works, which is
			 * why no other assertion here would notice; it just quietly replaces one
			 * long-lived connection with one per message, and on Workers each of
			 * those is a fresh billed request to the Durable Object.
			 */
			const streamsAfter = await ada.page.evaluate(
				() => (window as unknown as { __streams?: number }).__streams ?? 0
			);
			expect(streamsAfter).toBe(streamsBefore);
		} finally {
			await ada.close();
			await jun.close();
		}
	});

	test('a new thread appears on an open board with no reload', async ({ browser }) => {
		const ada = await newSide(browser, 'Ada');
		const jun = await newSide(browser, 'Jun');

		try {
			await signUp(ada.page, ada.who);
			await signUp(jun.page, jun.who);
			await linkAccounts(ada, jun);

			// Both get past the one-time warning, then Ada waits on her board.
			await jun.page.goto('/home');
			await openBoard(jun.page, 'Ada');
			await ada.page.goto('/home');
			await openBoard(ada.page, 'Jun');
			const adaBoardUrl = ada.page.url();
			await expect(ada.page.getByRole('link', { name: /message/ })).toHaveCount(0);

			await writeThread(jun.page, 'still awake?');

			await expect(ada.page.getByRole('link', { name: /^Unread message/ })).toHaveCount(1, {
				timeout: 20_000
			});
			expect(ada.page.url()).toBe(adaBoardUrl);
		} finally {
			await ada.close();
			await jun.close();
		}
	});
});

test.describe('attachments', () => {
	/**
	 * A file round trip: encrypted in Ada's browser under its own ephemeral key,
	 * stored as opaque bytes, downloaded by Jun and decrypted back into
	 * something an <img> will render.
	 *
	 * A tiny real PNG, built in the test rather than checked in, so there is no
	 * binary fixture to keep in the repo.
	 */
	const PNG = Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
		'base64'
	);

	test('an image travels encrypted and comes back renderable', async ({ browser }) => {
		const ada = await newSide(browser, 'Ada');
		const jun = await newSide(browser, 'Jun');

		try {
			await signUp(ada.page, ada.who);
			await signUp(jun.page, jun.who);
			await linkAccounts(ada, jun);

			await ada.page.goto('/home');
			await openBoard(ada.page, 'Jun');
			await expect(ada.page.locator('wa-dialog.composer-dialog')).toHaveCount(0);
			await clickWaButton(ada.page, 'Write something');
			await ada.page
				.locator('input[type="file"]')
				.setInputFiles({ name: 'sunset.png', mimeType: 'image/png', buffer: PNG });
			// The chip confirms the composer took it before the send.
			await expect(ada.page.getByText('sunset.png')).toBeVisible();

			await expect(ada.page.getByRole('button', { name: 'Send' })).toBeEnabled();
			await clickWaButton(ada.page, 'Send');
			await ada.page.waitForURL(/\/messages\/[0-9a-f-]{36}$/);
			await ada.page.goBack();
			const boardThumb = ada.page.locator('ul[aria-label] img.thumb').first();
			await expect(boardThumb).toBeVisible();
			await expect(boardThumb).toHaveAttribute('src', /^blob:/);
			const previewSizing = await boardThumb.evaluate((thumb) => {
				const preview = thumb.closest<HTMLElement>('.preview');
				if (!preview) return null;
				const previewRect = preview.getBoundingClientRect();
				const thumbRect = thumb.getBoundingClientRect();
				const style = getComputedStyle(thumb);
				return {
					widthDelta: Math.abs(previewRect.width - thumbRect.width),
					heightDelta: Math.abs(previewRect.height - thumbRect.height),
					objectFit: style.objectFit
				};
			});
			expect(previewSizing).not.toBeNull();
			expect(previewSizing!.widthDelta).toBeLessThanOrEqual(1);
			expect(previewSizing!.heightDelta).toBeLessThanOrEqual(1);
			expect(previewSizing!.objectFit).toBe('cover');

			// Jun reads it and the decrypted image renders from a blob: URL, which
			// is the proof it was decrypted in the browser rather than served.
			await jun.page.goto('/home');
			await openBoard(jun.page, 'Ada');
			await jun.page.getByRole('link', { name: /^Unread message/ }).click();
			await jun.page.waitForURL(/\/messages\/[0-9a-f-]{36}$/);

			const image = jun.page.getByRole('img', { name: 'sunset.png' });
			await expect(image).toBeVisible();
			await expect(image).toHaveAttribute('src', /^blob:/);
			// And it actually decoded — a broken image has zero natural width.
			await expect
				.poll(() => image.evaluate((el) => (el as HTMLImageElement).naturalWidth))
				.toBeGreaterThan(0);
		} finally {
			await ada.close();
			await jun.close();
		}
	});

	test('first-message preview fans out at most four items on the board', async ({ browser }) => {
		const ada = await newSide(browser, 'Ada');
		const jun = await newSide(browser, 'Jun');

		try {
			await signUp(ada.page, ada.who);
			await signUp(jun.page, jun.who);
			await linkAccounts(ada, jun);

			await ada.page.goto('/home');
			await openBoard(ada.page, 'Jun');
			await clickWaButton(ada.page, 'Write something');
			await fillRichText(ada.page, 'look at these');
			await ada.page.locator('input[type="file"]').setInputFiles([
				{ name: 'one.png', mimeType: 'image/png', buffer: PNG },
				{ name: 'two.png', mimeType: 'image/png', buffer: PNG },
				{ name: 'three.png', mimeType: 'image/png', buffer: PNG },
				{ name: 'four.png', mimeType: 'image/png', buffer: PNG },
				{ name: 'five.png', mimeType: 'image/png', buffer: PNG }
			]);

			await expect(ada.page.getByText('one.png')).toBeVisible();
			await expect(ada.page.getByText('two.png')).toBeVisible();
			await expect(ada.page.getByRole('button', { name: 'Send' })).toBeEnabled();
			await clickWaButton(ada.page, 'Send');
			await ada.page.waitForURL(/\/messages\/[0-9a-f-]{36}$/);
			await ada.page.goBack();

			const fan = ada.page.locator('ul[aria-label] .fan').first();
			await expect(fan).toBeVisible();
			await expect(fan.getByText('look at these')).toBeVisible();
			await expect(fan.locator('.fan-card')).toHaveCount(4);
			await expect(fan.locator('img.thumb')).toHaveCount(3);
			const fanSpread = async () =>
				fan.evaluate((element) => {
					const cards = Array.from(element.querySelectorAll<HTMLElement>('.fan-card'));
					if (cards.length === 0) return null;
					const fanRect = element.getBoundingClientRect();
					const rects = cards.map((card) => card.getBoundingClientRect());
					const minLeft = Math.min(...rects.map((rect) => rect.left));
					const maxRight = Math.max(...rects.map((rect) => rect.right));
					return {
						leftGap: minLeft - fanRect.left,
						rightGap: fanRect.right - maxRight,
						spread: maxRight - minLeft
					};
				});

			const before = await fanSpread();
			expect(before).not.toBeNull();
			expect(before!.leftGap).toBeLessThanOrEqual(24);
			expect(before!.rightGap).toBeLessThanOrEqual(24);
			const transition = await fan
				.locator('.fan-card')
				.first()
				.evaluate((card) => {
					const style = getComputedStyle(card);
					return { property: style.transitionProperty, duration: style.transitionDuration };
				});
			expect(transition.property).toContain('inset-inline-start');
			expect(transition.duration).not.toBe('0s');

			await fan.hover();
			await expect
				.poll(async () => {
					const after = await fanSpread();
					return after ? after.spread - before!.spread : 0;
				})
				.toBeGreaterThan(10);
			await expect
				.poll(async () => {
					const after = await fanSpread();
					return after ? Math.max(after.leftGap, after.rightGap) : 0;
				})
				.toBeLessThan(-10);
		} finally {
			await ada.close();
			await jun.close();
		}
	});

	/**
	 * The attachment endpoint must not hand a file over when it is addressed
	 * through the wrong partnership — including by someone who genuinely belongs
	 * to that other partnership, which is the sharper version of the mistake and
	 * the one only the re-join in `getAttachmentForDownload` prevents.
	 */
	test('will not serve an attachment through the wrong partnership', async ({ browser }) => {
		const ada = await newSide(browser, 'Ada');
		const jun = await newSide(browser, 'Jun');
		const cas = await newSide(browser, 'Cas');

		try {
			await signUp(ada.page, ada.who);
			await signUp(jun.page, jun.who);
			await signUp(cas.page, cas.who);
			await linkAccounts(ada, jun);
			await linkAccounts(ada, cas);

			// Capture the real download URL the page requests, so the ids are
			// genuine rather than guessed.
			const requested: string[] = [];
			ada.page.on('request', (request) => {
				if (request.url().includes('/attachments/')) requested.push(request.url());
			});

			await ada.page.goto('/home');
			await openBoard(ada.page, 'Jun');
			await expect(ada.page.locator('wa-dialog.composer-dialog')).toHaveCount(0);
			await clickWaButton(ada.page, 'Write something');
			await fillRichText(ada.page, 'private');
			await ada.page
				.locator('input[type="file"]')
				.setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: PNG });
			await expect(ada.page.getByRole('button', { name: 'Send' })).toBeEnabled();
			await clickWaButton(ada.page, 'Send');
			await ada.page.waitForURL(/\/messages\/[0-9a-f-]{36}$/);
			await expect(ada.page.getByRole('img', { name: 'a.png' })).toBeVisible();

			expect(requested.length).toBeGreaterThan(0);
			expect(new Set(requested).size).toBe(1);
			const path = new URL(requested[0]!).pathname;
			const junPartnership = path.split('/')[3];
			const attachmentId = path.split('/').at(-1);

			// Ada's other partnership, which she really is in.
			const casPartnership = await cas.page.evaluate(
				() => new URL(window.location.href).pathname.split('/')[2]
			);
			expect(casPartnership).not.toBe(junPartnership);

			const statuses = await ada.page.evaluate(
				async ([mine, other, id]) => {
					const get = async (partnership: string) =>
						(await fetch(`/api/partnerships/${partnership}/attachments/${id}`)).status;
					return { own: await get(mine), through: await get(other) };
				},
				[junPartnership, casPartnership, attachmentId] as [string, string, string]
			);

			// Through its own partnership: fine. Through the other one: gone.
			expect(statuses.own).toBe(200);
			expect(statuses.through).toBe(404);
		} finally {
			await ada.close();
			await jun.close();
			await cas.close();
		}
	});

	// A malformed request must be a refusal, not a crash. `request.formData()`
	// throws for a body that is not multipart, and an uncaught throw there was a
	// 500 until this test found it.
	test('refuses a send with no multipart body', async ({ browser }) => {
		const ada = await newSide(browser, 'Ada');
		const jun = await newSide(browser, 'Jun');

		try {
			await signUp(ada.page, ada.who);
			await signUp(jun.page, jun.who);
			await linkAccounts(ada, jun);

			await ada.page.goto('/home');
			await openBoard(ada.page, 'Jun');
			const partnershipId = new URL(ada.page.url()).pathname.split('/')[2];

			const status = await ada.page.evaluate(async (id) => {
				const response = await fetch(`/api/partnerships/${id}/threads`, { method: 'POST' });
				return response.status;
			}, partnershipId);

			expect(status).toBe(400);
		} finally {
			await ada.close();
			await jun.close();
		}
	});
});

test.describe('thread tags', () => {
	// The composer dialog used to have `light-dismiss`, and the tag dropdown's
	// popup counts as an outside click: selecting a tag flashed the chip and
	// closed the whole dialog. Only a real browser can see that, because it is
	// Web Awesome's popup layering doing the dismissing — jsdom never upgrades
	// `wa-dialog`, so the component tests are blind to it by design.
	test('picking a tag in the composer keeps the dialog open', async ({ browser }) => {
		const ada = await newSide(browser, 'Ada');
		const jun = await newSide(browser, 'Jun');

		try {
			await signUp(ada.page, ada.who);
			await signUp(jun.page, jun.who);
			await linkAccounts(ada, jun);

			await ada.page.goto('/home');
			await openBoard(ada.page, 'Jun');

			await clickWaButton(ada.page, 'Write something');
			// The composer's textarea, not the `wa-dialog` host: the host itself
			// carries no bounding box while the visible panel lives in its shadow
			// DOM, so a visibility assertion on the host is always "hidden".
			const composer = ada.page.getByLabel('Message to Jun');
			await expect(composer).toBeVisible();
			// Locator scope for the picker's controls — the dialog subtree, never the
			// textarea's, because the picker is a sibling of the composer.
			const dialog = ada.page.locator('wa-dialog');

			// Create one tag, so the dropdown has something real to select.
			await clickWaButton(ada.page, 'Add tag');
			await ada.page.locator('wa-dropdown-item').filter({ hasText: 'New tag' }).click();
			// Staged: the dialog must survive every popup interaction.
			await expect(composer).toBeVisible();
			await ada.page.getByLabel('New tag', { exact: true }).fill('planning');
			await ada.page.getByRole('button', { name: 'Add', exact: true }).click();
			await expect(composer).toBeVisible();
			await expect(dialog.getByText('planning')).toBeVisible();

			// Deselect it (chip pencil → trash), leaving it addable again.
			await dialog.getByRole('button', { name: 'Edit planning' }).click();
			await dialog.getByRole('button', { name: 'Remove tag' }).click();
			await expect(dialog.getByRole('button', { name: 'Edit planning' })).toHaveCount(0);

			// THE interaction that closed the dialog: selecting from the popup.
			await clickWaButton(ada.page, 'Add tag');
			await ada.page.locator('wa-dropdown-item').filter({ hasText: 'planning' }).click();
			await expect(composer).toBeVisible();

			await expect(dialog.getByText('planning')).toBeVisible();
			// The dialog itself survived: the composer is still there to type into.
			await expect(composer).toBeVisible();

			// No Save/Cancel in the composer's tag picker: sending the message is
			// the save, so the confirm pair belongs to the opened thread only.
			await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
			await expect(dialog.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
		} finally {
			await ada.close();
			await jun.close();
		}
	});
});
test.describe('embeds', () => {
	/**
	 * URLs in message bodies become links and inline embeds. The third-party
	 * requests are stubbed with `context.route` for two reasons: the suite must
	 * not depend on redgifs/reddit being up, and the fixture fails a run on
	 * console errors — a real third-party 404 or CORS complaint would fail the
	 * spec for reasons outside this app's control.
	 */
	test('renders redgifs and reddit embeds from a message', async ({ browser }) => {
		const ada = await newSide(browser, 'Ada');
		const jun = await newSide(browser, 'Jun');

		// Registered before any navigation so nothing slips through unstubbed.
		for (const page of [ada.page, jun.page]) {
			await page.route('**www.redgifs.com/**', (route) =>
				route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>gif</title>' })
			);
			await page.route('**/api/oembed**', (route) =>
				route.fulfill({
					contentType: 'application/json',
					body: JSON.stringify({
						title: 'A stubbed reddit post',
						provider_name: 'Reddit',
						html: '<iframe src="https://www.redditmedia.com/x/embed"></iframe>'
					})
				})
			);
			await page.route('**redditmedia.com/**', (route) =>
				route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>post</title>' })
			);
			await page.route('**noembed.com/**', (route) =>
				route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
			);
			// Revealing an embed also offers to cache its details on the message.
			// Answering "nothing known" keeps this test about live rendering, and
			// keeps the server off redgifs and reddit: a page route only covers
			// the browser's own requests, so an unstubbed reply here would have
			// our server resolving these URLs for real.
			await page.route('**/api/embed-metadata', (route) =>
				route.fulfill({ contentType: 'application/json', body: JSON.stringify({ embeds: [] }) })
			);
		}

		try {
			await signUp(ada.page, ada.who);
			await signUp(jun.page, jun.who);
			await linkAccounts(ada, jun);

			await ada.page.goto('/home');
			await openBoard(ada.page, 'Jun');
			// Every supported URL in a body embeds, so both can share one message.
			await writeThread(
				ada.page,
				'look https://www.redgifs.com/watch/abc123stub ' +
					'https://www.reddit.com/r/askreddit/comments/stub123/a_title/ ' +
					'and https://example.com/plain'
			);

			/**
			 * Until the viewer opts into automatic embeds, every supported URL in
			 * a message sits behind its own click gate — not just the reddit one.
			 * Loading any of them fetches third-party content for a decrypted
			 * message, so the click is the consent, per URL.
			 */
			const gateFor = (href: string) =>
				ada.page
					.locator('.gate')
					.filter({ has: ada.page.locator(`a[href="${href}"]`) })
					.getByRole('button', { name: 'Show' });

			await expect(ada.page.getByRole('button', { name: 'Show' })).toHaveCount(2);

			// Revealed, the redgifs player renders inline, sandboxed.
			await gateFor('https://www.redgifs.com/watch/abc123stub').click();
			const player = ada.page.locator('iframe[src="https://www.redgifs.com/ifr/abc123stub"]');
			await expect(player).toBeVisible();
			await expect(player).toHaveAttribute('sandbox', /allow-scripts/);
			await expect(player).not.toHaveAttribute('sandbox', /allow-top-navigation/);

			// Reddit is the strictest of them: resolving it sends the URL to our
			// own server, which only happens on that explicit click. Then the card
			// and the provider's iframe html render through the stubbed proxy.
			await gateFor('https://www.reddit.com/r/askreddit/comments/stub123/a_title/').click();
			await expect(ada.page.getByText('A stubbed reddit post')).toBeVisible();
			await expect(
				ada.page.locator('iframe[src="https://www.redditmedia.com/x/embed"]')
			).toBeVisible();

			// The plain link stays an anchor, with no gate of its own.
			await expect(ada.page.locator('a[href="https://example.com/plain"]')).toBeVisible();
			await expect(ada.page.getByRole('button', { name: 'Show' })).toHaveCount(0);
		} finally {
			await ada.close();
			await jun.close();
		}
	});

	test('prompts for auto-load on the third Show click and can be turned back off', async ({
		browser
	}) => {
		const ada = await newSide(browser, 'Ada');
		const jun = await newSide(browser, 'Jun');
		let serveSingleUrlMetadata = true;

		const embedFor = (href: string) => {
			const id = new URL(href).pathname.split('/').filter(Boolean).at(-1) ?? 'embed';
			return {
				href,
				fetchedAt: Date.now(),
				kind: 'iframe',
				providerName: 'Vimeo',
				title: `Preview ${id}`,
				description: null,
				thumbnailUrl: null,
				canonicalUrl: href,
				imageUrl: null,
				iframeSrc: `https://player.example/${id}`,
				iframeHeight: 360,
				faviconUrl: null,
				themeColor: null
			};
		};

		for (const page of [ada.page, jun.page]) {
			await page.route('**/api/embed-metadata', async (route) => {
				const body = (route.request().postDataJSON() ?? null) as { urls?: string[] } | null;
				const urls = Array.isArray(body?.urls) ? body.urls : [];
				if (urls.length !== 1 || !serveSingleUrlMetadata) {
					await route.fulfill({
						contentType: 'application/json',
						body: JSON.stringify({ embeds: [] })
					});
					return;
				}
				await route.fulfill({
					contentType: 'application/json',
					body: JSON.stringify({ embeds: urls.map(embedFor) })
				});
			});
			await page.route('**noembed.com/**', async (route) => {
				const target = route.request().url();
				const url = new URL(target);
				const href = url.searchParams.get('url') ?? 'https://vimeo.com/embed';
				const id = new URL(href).pathname.split('/').filter(Boolean).at(-1) ?? 'embed';
				await route.fulfill({
					contentType: 'application/json',
					body: JSON.stringify({
						title: `Preview ${id}`,
						provider_name: 'Vimeo',
						html: `<iframe src="https://player.example/${id}"></iframe>`
					})
				});
			});
			await page.route('**player.example/**', (route) =>
				route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>player</title>' })
			);
		}

		try {
			await signUp(ada.page, ada.who);
			await signUp(jun.page, jun.who);
			await linkAccounts(ada, jun);

			await ada.page.goto('/home');
			await openBoard(ada.page, 'Jun');
			await writeThread(
				ada.page,
				[
					'https://vimeo.com/1',
					'https://vimeo.com/2',
					'https://vimeo.com/3',
					'https://vimeo.com/4'
				].join('\n')
			);

			const threadUrl = ada.page.url();
			await expect(ada.page.getByRole('button', { name: 'Show' })).toHaveCount(4);

			for (const id of ['1', '2']) {
				await ada.page.getByRole('button', { name: 'Show' }).first().click();
				await expect(ada.page.getByText(`Preview ${id}`)).toBeVisible();
			}

			await ada.page.getByRole('button', { name: 'Show' }).first().click();
			await expect(
				ada.page.getByText(/Showing URL embeds sends the linked URL to Bound Up's servers/)
			).toBeVisible();
			await clickWaButton(ada.page, 'Yes, load automatically');

			await expect(ada.page.getByRole('button', { name: 'Show' })).toHaveCount(0);
			await expect(ada.page.getByText('Preview 4')).toBeVisible();

			await ada.page.reload();
			await expect(ada.page.getByRole('button', { name: 'Show' })).toHaveCount(0);
			await expect(ada.page.getByText('Preview 4')).toBeVisible();

			await ada.page.goto('/settings/encryption');
			// Not before hydration: this select saves through a fetch, so until
			// the client has taken over a change is dropped AND hydration writes
			// the old value back over it — the page then looks like it kept the
			// new choice while having saved nothing. `data-ready` is set from
			// onMount, the same signal waitForEnhancedForm uses for the forms.
			const embedChoice = ada.page.locator('.embed-choice select[data-ready]');
			await embedChoice.selectOption('manual');
			await expect(embedChoice).toHaveValue('manual');

			serveSingleUrlMetadata = false;
			await ada.page.goto(threadUrl);
			await reply(ada.page, 'https://vimeo.com/5');
			await expect(ada.page.getByRole('button', { name: 'Show' })).toHaveCount(5);
		} finally {
			await ada.close();
			await jun.close();
		}
	});
});
