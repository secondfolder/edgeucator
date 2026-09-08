/**
 * The Durable Object namespace, from `event.platform`.
 *
 * Hand-declared rather than imported from `@cloudflare/workers-types`, for the
 * reason `app.d.ts` and `server/media/index.ts` both give: that package
 * publishes its types as ambient globals and would overwrite the DOM's
 * `Request`/`Response`/`fetch` project-wide, including the jsdom test project.
 * Only the two methods this app calls are declared, so the two implementations
 * cannot drift apart on anything wider.
 */

export type DurableObjectIdLike = { toString(): string };

export type DurableObjectStubLike = {
	fetch(input: string | Request, init?: RequestInit): Promise<Response>;
};

export type RealtimeNamespace = {
	/**
	 * A stable id from a name.
	 *
	 * `idFromName(partnershipId)` is what makes the room addressable without
	 * storing an id anywhere: both partners' devices derive the same object from
	 * the same partnership id.
	 */
	idFromName(name: string): DurableObjectIdLike;
	get(id: DurableObjectIdLike): DurableObjectStubLike;
};

/**
 * Fails with a message naming the fix, rather than a
 * `Cannot read properties of undefined`.
 *
 * `event.platform` is populated only on Workers (`wrangler dev` or deployed) —
 * `svelte.config.js` strips the adapter's `emulate` hook, so under `vite dev`
 * there is no platform at all and the module-level `Map` in `./local.ts` is
 * used instead. Same shape as `media/platform.ts` and `db/platform.ts`.
 */
export function requireRealtime(platform: App.Platform | undefined): RealtimeNamespace {
	if (!platform?.env?.REALTIME) {
		throw new Error(
			'The Durable Object binding "REALTIME" is unavailable. This code path ' +
				'only runs on Cloudflare Workers. Check that wrangler.jsonc has a ' +
				'durable_objects binding named "REALTIME" pointing at the ' +
				'"RealtimeRoom" class, that the top-level `migrations` array declares ' +
				'it, and that wrangler was given the custom entry — ' +
				'`wrangler dev worker.ts`, not plain `wrangler dev`. Note that ' +
				'`npm run dev` never reads this: it uses an in-process Map instead.'
		);
	}
	return platform.env.REALTIME;
}
