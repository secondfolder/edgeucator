import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertStorageKey, type MediaStore } from './index';

/**
 * The development store: encrypted attachments in a local directory.
 *
 * Exists so that `npm run dev` needs no Cloudflare account and no R2 bucket,
 * exactly as `db/dev.ts` does for the database. It is imported only from inside
 * a `if (dev)` branch, so `node:fs` is dead-code-eliminated from the worker
 * bundle.
 *
 * Buffered rather than streamed. That is a real difference from the R2
 * implementation, and it is acceptable only because this path is dev-only and
 * capped at 25 MB a message — it would not be acceptable in production.
 */
export function createLocalStore(root: string): MediaStore {
	/**
	 * Turns a key into a path under `root`.
	 *
	 * The key check is the one place the two implementations are genuinely NOT
	 * equivalent: R2 does not care what is in a key, but here the separators
	 * become directories, so a `..` in a key is a path traversal. Keys are built
	 * from UUIDs by `attachmentKey`, so this should never fire — which is
	 * exactly why it must be checked rather than assumed.
	 */
	function resolve(key: string): string {
		assertStorageKey(key);
		const full = path.resolve(root, key);
		// Belt and braces: even with the key check, refuse anything that has
		// escaped the root.
		if (!full.startsWith(path.resolve(root) + path.sep)) {
			throw new Error(`Refusing a storage key that escapes the media root: ${key}`);
		}
		return full;
	}

	async function collect(body: ReadableStream<Uint8Array>): Promise<Uint8Array> {
		const chunks: Uint8Array[] = [];
		const reader = body.getReader();
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value);
		}
		const out = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
		let at = 0;
		for (const chunk of chunks) {
			out.set(chunk, at);
			at += chunk.length;
		}
		return out;
	}

	return {
		async put(key, body, byteSize) {
			const full = resolve(key);
			await mkdir(path.dirname(full), { recursive: true });
			const bytes = await collect(body);
			if (bytes.length !== byteSize) {
				throw new Error(`Declared ${byteSize} bytes but received ${bytes.length}`);
			}
			await writeFile(full, bytes);
		},

		async get(key) {
			try {
				const bytes = await readFile(resolve(key));
				return {
					body: new Blob([bytes as BlobPart]).stream() as ReadableStream<Uint8Array>,
					byteSize: bytes.byteLength
				};
			} catch (error) {
				if ((error as { code?: string }).code === 'ENOENT') return null;
				throw error;
			}
		},

		async delete(keys) {
			for (const key of keys) await rm(resolve(key), { force: true });
		},

		async deletePrefix(prefix) {
			// Prefixes here are always `messages/<id>/`, i.e. a directory, so this
			// counts the files it is about to remove and then drops the tree.
			const directory = path.resolve(root, prefix.replace(/\/$/, ''));
			if (!directory.startsWith(path.resolve(root) + path.sep)) {
				throw new Error(`Refusing a prefix that escapes the media root: ${prefix}`);
			}
			let deleted = 0;
			try {
				for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) {
					if (entry.isFile()) deleted += 1;
				}
			} catch (error) {
				if ((error as { code?: string }).code === 'ENOENT') return 0;
				throw error;
			}
			await rm(directory, { recursive: true, force: true });
			return deleted;
		}
	};
}
