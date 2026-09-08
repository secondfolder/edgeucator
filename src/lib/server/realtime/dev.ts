import { dev } from '$app/environment';
import type { Notifier } from './index';

let devNotifier: Notifier | undefined;

/**
 * Returns the request's notifier.
 *
 * Production fans out through a Durable Object over
 * `event.platform.env.REALTIME`. Local dev uses a module-level `Map`, so
 * `npm run dev` needs no Cloudflare account — the same arrangement
 * `db/dev.ts` and `media/dev.ts` make, and for the same reason:
 * `svelte.config.js` strips the adapter's `emulate` hook, so `vite dev` has no
 * `platform` at all.
 *
 * Deliberately NOT placed on `event.locals` like `db` is. Five handlers out of
 * roughly forty need it, and `locals` is built for every single request.
 */
export async function createNotifier(event: {
	platform?: App.Platform | undefined;
}): Promise<Notifier> {
	// `dev` is a build-time constant, so this branch — and with it the whole
	// module-level Map — is dead-code-eliminated from the worker bundle.
	if (dev) {
		if (!devNotifier) {
			const { createLocalNotifier } = await import('./local');
			devNotifier = createLocalNotifier();
		}
		// A module-level cache is safe ONLY because this branch is dev-only, where
		// there is one process and the Map genuinely is shared state. The
		// production path below stays strictly per-request, since the binding does.
		return devNotifier;
	}

	const { createDurableObjectNotifier } = await import('./remote');
	const { requireRealtime } = await import('./binding');
	return createDurableObjectNotifier(requireRealtime(event.platform));
}

export type { Notifier };
