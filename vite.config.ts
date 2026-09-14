import { svelteTesting } from '@testing-library/svelte/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type Plugin } from 'vitest/config';

const host: string | undefined = process.env.HOST;
const port: number = Number(process.env.PORT) || 58769;

/**
 * Removes bare `import "devalue";` statements generated into server chunks by
 * SvelteKit/Rollup tree-shaking when no devalue exports are used in that chunk.
 * `devalue` has `"sideEffects": false`, so Wrangler's esbuild pass warns on it.
 */
function removeBareDevalueImport(): Plugin {
	return {
		name: 'remove-bare-devalue-import',
		generateBundle(_options, bundle) {
			for (const file of Object.values(bundle)) {
				if (file.type === 'chunk' && file.code.includes('devalue')) {
					file.code = file.code.replace(/import\s*["']devalue["'];?\n?/g, '');
				}
			}
		}
	};
}

export default defineConfig({
	plugins: [sveltekit(), removeBareDevalueImport()],

	test: {
		projects: [
			{
				extends: './vite.config.ts',
				plugins: [svelteTesting()],

				test: {
					name: 'client',
					environment: 'jsdom',
					clearMocks: true,
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**'],
					setupFiles: ['./vitest-setup-client.ts']
				}
			},
			{
				extends: './vite.config.ts',

				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	},

	optimizeDeps: {
		/**
		 * Pre-bundled because nothing imports them statically.
		 *
		 * `src/lib/crypto/identity.ts` reaches both through `await import()`, on
		 * purpose — age-encryption drags in ML-KEM for a feature this app never
		 * uses, and the login and signup pages must not pay for it. But that also
		 * hides them from Vite's dependency scan, so the first thread anyone opens
		 * triggers a *"Forced re-optimization of dependencies"* mid-session, and
		 * Vite tells every connected client to reload.
		 *
		 * A reload landing on an in-flight form submit loses it, with no request
		 * made and no error anywhere — which showed up as the Playwright suite
		 * failing about one run in three, always on whichever test followed the
		 * first dynamic import. Listing them here moves the work to server start.
		 */
		include: ['age-encryption', '@scure/base', 'html2canvas-pro']
	},

	server: {
		host: host,
		port: port,
		// Overridable so the Playwright suite can run against localhost: with the
		// tunnel host baked in, a page served from 127.0.0.1 asks the tunnel for
		// its modules and never hydrates.
		origin: process.env.VITE_DEV_ORIGIN
	}
});
