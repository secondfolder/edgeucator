import { assertStorageKey, type MediaBucket, type MediaStore } from './index';

/** The production store: encrypted attachments in an R2 bucket. */
export function createR2Store(bucket: MediaBucket): MediaStore {
	return {
		async put(key, body, byteSize) {
			assertStorageKey(key);
			// R2 wants a length for a stream; the caller already knows it, and age
			// can compute a ciphertext size from a plaintext size exactly.
			await bucket.put(key, body, { httpMetadata: {}, contentLength: byteSize });
		},

		async get(key) {
			assertStorageKey(key);
			const object = await bucket.get(key);
			if (!object) return null;
			return { body: object.body, byteSize: object.size };
		},

		async delete(keys) {
			if (keys.length === 0) return;
			// R2 accepts at most 1000 keys per call.
			for (let i = 0; i < keys.length; i += 1000) {
				await bucket.delete(keys.slice(i, i + 1000));
			}
		},

		async deletePrefix(prefix) {
			assertStorageKey(prefix.replace(/\/$/, ''));
			let deleted = 0;
			let cursor: string | undefined;
			// Paged, because `list` returns at most 1000 objects and a long-running
			// partnership can hold more than that.
			do {
				const listing = await bucket.list({ prefix, cursor, limit: 1000 });
				const keys = listing.objects.map((object) => object.key);
				if (keys.length > 0) {
					await bucket.delete(keys);
					deleted += keys.length;
				}
				cursor = listing.truncated ? listing.cursor : undefined;
			} while (cursor);
			return deleted;
		}
	};
}
