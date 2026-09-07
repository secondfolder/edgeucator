import { assertStorageKey, type MediaStore } from '../server/media';

/**
 * An in-memory `MediaStore` for server tests.
 *
 * The third implementation of the interface, which is what proves the interface
 * is genuinely abstract rather than R2 with extra steps. It also lets a test
 * assert that *no* object was written when a send is refused, which is the only
 * way to check the "R2 first, rows second" ordering rule from the outside.
 */
export type TestMediaStore = MediaStore & {
	objects: Map<string, Uint8Array>;
	/** Set to make the next `put` throw, for the crash-ordering test. */
	failNextPut: boolean;
};

async function collect(body: ReadableStream<Uint8Array>): Promise<Uint8Array> {
	const chunks: Uint8Array[] = [];
	const reader = body.getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
	}
	const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}
	return out;
}

export function createTestMediaStore(): TestMediaStore {
	const objects = new Map<string, Uint8Array>();

	const store: TestMediaStore = {
		objects,
		failNextPut: false,

		async put(key, body, byteSize) {
			assertStorageKey(key);
			if (store.failNextPut) {
				store.failNextPut = false;
				throw new Error('simulated media store failure');
			}
			const bytes = await collect(body);
			if (bytes.length !== byteSize) {
				throw new Error(`Declared ${byteSize} bytes but received ${bytes.length}`);
			}
			objects.set(key, bytes);
		},

		async get(key) {
			const bytes = objects.get(key);
			if (!bytes) return null;
			return {
				body: new Blob([bytes as BlobPart]).stream() as ReadableStream<Uint8Array>,
				byteSize: bytes.length
			};
		},

		async delete(keys) {
			for (const key of keys) objects.delete(key);
		},

		async deletePrefix(prefix) {
			let deleted = 0;
			for (const key of [...objects.keys()]) {
				if (key.startsWith(prefix)) {
					objects.delete(key);
					deleted += 1;
				}
			}
			return deleted;
		}
	};

	return store;
}

/** A `ReadableStream` over fixed bytes, for building fake attachments. */
export function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
	return new Blob([bytes as BlobPart]).stream() as ReadableStream<Uint8Array>;
}

/**
 * An `OutgoingAttachment` with an id already chosen.
 *
 * Ids come from the client in production — the decryption keys live inside the
 * encrypted body, so they have to exist before it is sealed — so a test fixture
 * has to supply one too.
 */
export function outgoingAttachment(
	bytes: Uint8Array,
	id: string = crypto.randomUUID()
): { id: string; body: ReadableStream<Uint8Array>; byteSize: number } {
	return { id, body: streamOf(bytes), byteSize: bytes.length };
}
