import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import type { MediaStore } from './index';

let devStore: MediaStore | undefined;

/**
 * Returns the request's media store.
 *
 * Production uses R2 over `event.platform.env.MEDIA`. Local dev writes to a
 * plain directory, so `npm run dev` needs no Cloudflare account — the same
 * arrangement `db/dev.ts` makes for the database, and for the same reason:
 * `svelte.config.js` strips the adapter's `emulate` hook, so `vite dev` has no
 * `platform` at all.
 *
 * Deliberately NOT placed on `event.locals` like `db` is. Three handlers out of
 * roughly forty need it, and `locals` is built for every single request.
 */
export async function createMediaStore(event: {
	platform?: App.Platform | undefined;
}): Promise<MediaStore> {
	// `dev` is a build-time constant, so this branch — and with it the whole
	// `node:fs` import — is dead-code-eliminated from the worker bundle.
	if (dev) {
		if (!devStore) {
			const { createLocalStore } = await import('./local');
			devStore = createLocalStore(env.MEDIA_DIR || './local-media');
		}
		// A module-level cache is safe ONLY because this branch is dev-only; the
		// production path below stays strictly per-request, since the binding does.
		return devStore;
	}

	const { createR2Store } = await import('./r2');
	const { requireR2 } = await import('./platform');
	return createR2Store(requireR2(event.platform));
}

export type { MediaStore };
