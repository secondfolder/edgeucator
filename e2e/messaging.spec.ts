import { expect, test } from '@playwright/test';
import { THREAD_ICON_LABELS } from '../src/lib/messaging';
import {
	clickWaButton,
	fillWaTextarea,
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

			await writeThread(ada.page, secret, 'bottle-droplet');
			// She is in the thread she just started, and can read her own message.
			await expect(ada.page.getByText(secret)).toBeVisible();

			// ── Jun is told ─────────────────────────────────────────────────────
			await jun.page.goto('/home');
			const link = jun.page.getByRole('link', { name: /1 new message from Ada/ });
			await expect(link).toBeVisible();

			// ── Jun reads it ────────────────────────────────────────────────────
			await link.click();
			await jun.page.waitForURL(/\/messages$/);
			// Past the one-time warning, then the sticker Ada chose.
			await jun.page.getByRole('checkbox').check();
			await clickWaButton(jun.page, 'Start messaging');

			const sticker = jun.page.getByRole('link', { name: /^Unread message 1 of 1/ });
			await expect(sticker).toBeVisible();
			await expect(sticker.locator('wa-icon')).toHaveAttribute('name', 'bottle-droplet');

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

			await fillWaTextarea(jun.page, 'very');
			await clickWaButton(jun.page, 'Send');
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
			await writeThread(ada.page, 'the first one', 'envelope');
			await ada.page.goBack();
			await writeThread(ada.page, 'the second one', 'fire');

			await jun.page.goto('/home');
			await openBoard(jun.page, 'Ada');

			// Both unread, newest at the top, and no seam yet.
			const unread = jun.page.getByRole('list', { name: 'Unread' });
			await expect(unread.getByRole('listitem')).toHaveCount(2);
			await expect(unread.locator('wa-icon').first()).toHaveAttribute('name', 'fire');
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
			await expect(read.locator('wa-icon').first()).toHaveAttribute('name', 'fire');
		} finally {
			await ada.close();
			await jun.close();
		}
	});

	/**
	 * The sticker layout is derived from the thread id, so it has to be
	 * identical across reloads — that is the requirement, and an
	 * index-derived layout would silently satisfy every other assertion here.
	 */
	test('lays the stickers out identically on every load', async ({ browser }) => {
		const ada = await newSide(browser, 'Ada');
		const jun = await newSide(browser, 'Jun');

		try {
			await signUp(ada.page, ada.who);
			await signUp(jun.page, jun.who);
			await linkAccounts(ada, jun);

			await ada.page.goto('/home');
			await openBoard(ada.page, 'Jun');
			for (const text of ['one', 'two', 'three']) {
				await writeThread(ada.page, text);
				await ada.page.goBack();
			}

			const stickers = ada.page.locator('ul[aria-label] > li > a');
			await expect(stickers).toHaveCount(3);

			/**
			 * The computed transform rather than the `style` attribute.
			 *
			 * It is what the requirement is actually about — the sticker being
			 * tilted and offset — and it holds however the custom properties reach
			 * the element.
			 */
			const transforms = () =>
				stickers.evaluateAll((els) => els.map((el) => getComputedStyle(el).transform));

			const before = await transforms();
			// Applied at all: a matrix, not `none`.
			expect(before.every((value) => value.startsWith('matrix'))).toBe(true);
			// And not all identical, or the jitter is not deriving from the id.
			expect(new Set(before).size).toBeGreaterThan(1);

			await ada.page.reload();
			await expect(stickers).toHaveCount(3);
			// The actual requirement: identical on every load.
			expect(await transforms()).toEqual(before);
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
				const Real = target.EventSource as new (url: string) => unknown;
				target.__streams = 0;
				target.EventSource = class extends (Real as never) {
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

			await fillWaTextarea(jun.page, 'come over');
			await clickWaButton(jun.page, 'Send');
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
			await clickWaButton(ada.page, 'Write something');
			await ada.page.getByRole('radio', { name: THREAD_ICON_LABELS['gem'] }).click({ force: true });
			await fillWaTextarea(ada.page, 'look at this');
			await ada.page
				.locator('input[type="file"]')
				.setInputFiles({ name: 'sunset.png', mimeType: 'image/png', buffer: PNG });
			// The chip confirms the composer took it before the send.
			await expect(ada.page.getByText('sunset.png')).toBeVisible();

			await expect(ada.page.getByRole('button', { name: 'Send it' })).toBeEnabled();
			await clickWaButton(ada.page, 'Send it');
			await ada.page.waitForURL(/\/messages\/[0-9a-f-]{36}$/);

			// Jun reads it and the decrypted image renders from a blob: URL, which
			// is the proof it was decrypted in the browser rather than served.
			await jun.page.goto('/home');
			await openBoard(jun.page, 'Ada');
			await jun.page.getByRole('link', { name: /^Unread message/ }).click();
			await jun.page.waitForURL(/\/messages\/[0-9a-f-]{36}$/);
			await expect(jun.page.getByText('look at this')).toBeVisible();

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
			await clickWaButton(ada.page, 'Write something');
			await fillWaTextarea(ada.page, 'private');
			await ada.page
				.locator('input[type="file"]')
				.setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: PNG });
			await expect(ada.page.getByRole('button', { name: 'Send it' })).toBeEnabled();
			await clickWaButton(ada.page, 'Send it');
			await ada.page.waitForURL(/\/messages\/[0-9a-f-]{36}$/);
			await expect(ada.page.getByRole('img', { name: 'a.png' })).toBeVisible();

			expect(requested).toHaveLength(1);
			const path = new URL(requested[0]).pathname;
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
