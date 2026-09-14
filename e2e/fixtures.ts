import { test as base, type Browser, type Page } from '@playwright/test';

/**
 * The one net the suite did not have: browser-engine diagnostics.
 *
 * Neither the jsdom component tests (where `wa-*` elements never upgrade) nor
 * these specs asserted on the browser console, so a `pattern` attribute that
 * Chromium cannot compile — Zod's `z.email()` regex, invalid under the `v` flag
 * pattern attributes are compiled with — shipped while logging
 * "Unable to check <input pattern=…> because … is not a valid regexp" on every
 * login page load. The inputs still worked (an uncompilable pattern is
 * ignored, and the server re-validates with Zod), so no behaviour assertion
 * could fail either.
 *
 * This fixture wraps `browser` so that every context the tests create — the
 * default `page` fixture goes through `browser.newContext()` too — gets its
 * pages watched. Any console warning or error, or any uncaught `pageerror`, is
 * collected and fails the run at worker teardown, when it can no longer break
 * the steps that follow. `browser` is worker-scoped, so the collection spans
 * every test in the file rather than one test — with the suite pinned to a
 * single worker that still points at the spec file, which is enough to act on.
 *
 * Two deliberate exclusions:
 *
 * - "Failed to load resource" is Chromium's network log, not script output.
 *   Several specs intentionally provoke 401/404 responses, and those belong to
 *   the assertions that check them, not to this net.
 * - Lit logs a dev-mode banner under `vite dev`, which is the server Playwright
 *   runs against. That is environment noise rather than an app regression, so
 *   the watcher ignores it instead of making every e2e run fail by design.
 * - Chromium logs a WebGL performance warning when the landing page's halftone
 *   overlay reads back its canvas. That readback is deliberate — the overlay's
 *   own e2e assertion depends on it — and the warning is browser noise rather
 *   than a functional failure.
 * - The list of watchers is per-test (the fixture rebuilds it), so nothing
 *   leaks between tests even though contexts are closed lazily.
 *
 * `browser.newPage()` would bypass the proxy — it creates its context
 * server-side — but nothing in the suite calls it; if a spec ever does, route
 * it through `newContext().newPage()` instead.
 */

const IGNORED = [
	/^Failed to load resource/,
	/^Lit is in dev mode\. Not recommended for production!/,
	/^\[\.WebGL-[^\]]+\]GL Driver Message \(OpenGL, Performance, GL_CLOSE_PATH_NV, High\): GPU stall due to ReadPixels/
];
const FAILING_CONSOLE_TYPES = new Set(['warning', 'error']);

export const test = base.extend<{ browser: Browser }>({
	browser: [
		async ({ browser }, use) => {
			const diagnostics: string[] = [];

			function watchPage(page: Page) {
				page.on('console', (message) => {
					if (!FAILING_CONSOLE_TYPES.has(message.type())) return;
					const text = message.text();
					if (IGNORED.some((pattern) => pattern.test(text))) return;
					diagnostics.push(`${message.type()}: ${text}`);
				});
				page.on('pageerror', (error) => diagnostics.push(`pageerror: ${String(error)}`));
			}

			const watched = new Proxy(browser, {
				get(target, prop, receiver) {
					if (prop === 'newContext') {
						return async (...args: Parameters<Browser['newContext']>) => {
							const context = await target.newContext(...args);
							context.on('page', watchPage);
							return context;
						};
					}
					return Reflect.get(target, prop, receiver);
				}
			});

			await use(watched);

			if (diagnostics.length > 0) {
				// Thrown from worker teardown, so the run fails with the messages
				// even though every behavioural assertion still passed.
				throw new Error(
					`Browser reported diagnostics during this spec file:\n${[...new Set(diagnostics)]
						.map((text) => `  - ${text}`)
						.join('\n')}`
				);
			}
		},
		{ scope: 'worker' }
	]
});

export { expect } from '@playwright/test';
