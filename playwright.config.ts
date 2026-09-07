import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end coverage of the partner invite flow.
 *
 * The vitest suites call loads and actions directly, which cannot see the
 * things that only exist over HTTP: the auth hook, real session cookies, the
 * `(auth-required)` group guard, and the round trip through /signup that an
 * invite link has to survive. That is what these are for.
 *
 * Runs against `vite dev` on its own port and its own SQLite file, so a local
 * `local.db` is never touched.
 */

const PORT = 5175;
const BASE_URL = `http://localhost:${PORT}`;

export const E2E_DATABASE_URL = 'file:./e2e.db';

export default defineConfig({
	testDir: 'e2e',
	// The suite shares one database, and the flows sign in and out of the same
	// browser context, so it is deliberately serial.
	workers: 1,
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	// Generous because these run against `vite dev`, which compiles each route
	// the first time it is requested — the first pass through a flow pays for
	// every screen in it.
	timeout: 90_000,
	expect: { timeout: 15_000 },
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? 'github' : 'list',
	use: {
		baseURL: BASE_URL,
		trace: 'retain-on-failure'
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		// The database is rebuilt as part of the server command rather than in a
		// globalSetup, because Playwright starts the web server FIRST: its health
		// check opens the SQLite file, and deleting it afterwards left every
		// write failing with SQLITE_READONLY_DBMOVED.
		//
		// Rebuilt from the committed migrations, and from empty, because the flows
		// assert on "you have no partners yet" — leftovers from a previous run
		// would make a failure depend on what ran last.
		command:
			`rm -f e2e.db e2e.db-shm e2e.db-wal && npx drizzle-kit migrate && ` +
			`npx vite dev --port ${PORT} --strictPort`,
		url: BASE_URL,
		reuseExistingServer: false,
		stdout: 'pipe',
		stderr: 'pipe',
		timeout: 120_000,
		env: {
			DATABASE_URL: E2E_DATABASE_URL,
			// hooks.server.ts throws without this rather than letting Better Auth
			// fall back to its hard-coded default.
			BETTER_AUTH_SECRET: 'e2e-secret-not-used-anywhere-else',
			// vite.config.ts points `server.origin` at a personal dev tunnel, which
			// would make the page ask localhost for its assets over that hostname.
			VITE_DEV_ORIGIN: BASE_URL
		}
	}
});
