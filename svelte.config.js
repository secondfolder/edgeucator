import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const cloudflare = adapter();

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		// `vite dev` serves through SvelteKit's own Node server, not the worker. The
		// adapter's ONLY role in dev/preview/prerender is `emulate()`, which boots
		// miniflare to supply `event.platform` (kit only sets it when
		// `state.emulator?.platform` exists). Dev reads neither platform.env.DB (it
		// uses ./local.db via libsql) nor platform.env secrets (they come from .env),
		// so dropping `emulate` skips workerd entirely and makes the presence of
		// `platform` mean exactly "running on Workers".
		//
		// `vite build` still uses the full adapter. Run `npm run preview:worker`
		// (real wrangler dev) to exercise the platform path before deploying.
		adapter: { ...cloudflare, emulate: undefined }
	}
};

export default config;
