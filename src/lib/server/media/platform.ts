import type { MediaBucket } from './index';

/**
 * Extracts the R2 binding from `event.platform`, failing with a message that
 * names the fix rather than a `Cannot read properties of undefined`.
 *
 * `event.platform` is populated only when running on Workers (`wrangler dev` or
 * deployed) — `svelte.config.js` strips the adapter's `emulate` hook, so in
 * `vite dev` there is no platform at all and the local-directory path in
 * `./dev.ts` is used instead. Same shape as `db/platform.ts`.
 */
export function requireR2(platform: App.Platform | undefined): MediaBucket {
	if (!platform?.env?.MEDIA) {
		throw new Error(
			'The R2 binding "MEDIA" is unavailable. This code path only runs on ' +
				'Cloudflare Workers. Create the bucket with ' +
				'`npx wrangler r2 bucket create bound-up-media`, check that ' +
				'wrangler.jsonc has an r2_buckets entry with "binding": "MEDIA", and ' +
				'note that `npm run dev` never reads it — it writes to ./local-media ' +
				'instead.'
		);
	}
	return platform.env.MEDIA;
}
