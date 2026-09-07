/**
 * Where encrypted attachments live.
 *
 * An interface with two real implementations, for the reason
 * `src/lib/server/db/dev.ts` gives about the database: `svelte.config.js`
 * strips the Cloudflare adapter's `emulate` hook, so `vite dev` has no
 * `event.platform` at all and therefore no R2 binding. Production gets R2; dev
 * gets a local directory. See `dev.ts` for the switch.
 *
 * Only the four operations messaging actually needs, so the two are genuinely
 * interchangeable and neither can leak a capability the other lacks — the same
 * reason `db/index.ts` types `Db` as the D1 client and casts the dev one to it.
 */
export type MediaStore = {
	/**
	 * Writes an object. `byteSize` is passed separately because R2 wants a
	 * length for a stream and the caller already knows it.
	 */
	put(key: string, body: ReadableStream<Uint8Array>, byteSize: number): Promise<void>;
	get(key: string): Promise<{ body: ReadableStream<Uint8Array>; byteSize: number } | null>;
	delete(keys: string[]): Promise<void>;
	/** Returns how many objects went. R2 deletes at most 1000 keys per call. */
	deletePrefix(prefix: string): Promise<number>;
};

/**
 * Object keys are `messages/<partnershipId>/<messageId>/<attachmentId>`.
 *
 * The prefix layout exists so that disconnecting can delete a partnership's
 * media in one call without enumerating rows. The key is still stored on the
 * row, so this layout can change without a migration.
 */
/**
 * The three R2 methods this app uses, hand-declared.
 *
 * `@cloudflare/workers-types` is deliberately not imported, for the reason
 * `app.d.ts` already gives: it publishes its types as ambient globals, and
 * pulling them in would overwrite the DOM's `Request`/`Response`/`fetch` for
 * the whole project — including the jsdom test project.
 */
export type MediaBucket = {
	put(
		key: string,
		body: ReadableStream<Uint8Array>,
		options?: { httpMetadata?: Record<string, string>; contentLength?: number }
	): Promise<unknown>;
	get(key: string): Promise<{ body: ReadableStream<Uint8Array>; size: number } | null>;
	delete(keys: string | string[]): Promise<void>;
	list(options?: {
		prefix?: string;
		cursor?: string;
		limit?: number;
	}): Promise<{ objects: { key: string }[]; truncated: boolean; cursor?: string }>;
};

export function attachmentKey(
	partnershipId: string,
	messageId: string,
	attachmentId: string
): string {
	return `messages/${partnershipId}/${messageId}/${attachmentId}`;
}

/** Everything belonging to one partnership, for `deletePrefix`. */
export function partnershipMediaPrefix(partnershipId: string): string {
	return `messages/${partnershipId}/`;
}

/**
 * The shape of a key both implementations will accept.
 *
 * R2 does not care what is in a key, but the local dev store turns separators
 * into directories, where `..` is a path traversal. This is the one place the
 * two implementations are genuinely not equivalent, so the restriction is
 * declared here — against the interface — rather than only in the local store,
 * and `attachmentKey` is built from UUIDs so it always satisfies it.
 */
export const STORAGE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9/_-]*$/;

export function assertStorageKey(key: string): void {
	if (!STORAGE_KEY_PATTERN.test(key) || key.includes('..')) {
		throw new Error(`Refusing an unsafe storage key: ${JSON.stringify(key)}`);
	}
}
