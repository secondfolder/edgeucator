import {
	SSE_HEADERS,
	SSE_QUEUE_LIMIT,
	SSE_KEEPALIVE,
	SSE_KEEPALIVE_MS,
	SSE_PREAMBLE,
	encodeSseEvent,
	type RealtimeEvent
} from './index';

/**
 * One room per partnership, holding only the open connections watching it.
 *
 * **This file and `worker.ts` are a second alias-free zone.** They are bundled
 * by wrangler's esbuild, which resolves neither `$lib` nor any of SvelteKit's
 * aliases — so every import here is relative, and `./index` is the only one.
 *
 * Written in the classic `(state, env)` + `fetch` style rather than by
 * extending `DurableObject` from `cloudflare:workers`, and that is deliberate:
 * that base class has no types without `@cloudflare/workers-types`, a package
 * AGENTS.md forbids because it publishes its types as ambient globals and would
 * overwrite the DOM's `Request`/`Response`/`fetch` for the whole project,
 * including the jsdom test project. The classic style needs no types at all.
 *
 * The object holds **no storage** and never sees message content — see the note
 * on `RealtimeEvent`. Everything it knows is which sockets are open, which is
 * why it can be discarded and recreated at any time with no consequence beyond
 * clients reconnecting.
 */

/**
 * The slice of `DurableObjectState` this class uses — which is none of it.
 *
 * Declared rather than imported, and kept as a name rather than dropped, so the
 * constructor signature stays recognisable to anyone comparing it against
 * Cloudflare's docs.
 */
type DurableObjectStateLike = object;

const encoder = new TextEncoder();

export class RealtimeRoom {
	/**
	 * The open streams.
	 *
	 * Writers rather than controllers because a `TransformStream`'s writer is
	 * what Workers gives back for a streaming `Response`, and a failed `write`
	 * is how a hung-up client announces itself.
	 */
	#writers = new Set<WritableStreamDefaultWriter<Uint8Array>>();

	constructor(
		private state: DurableObjectStateLike,
		private env: unknown
	) {
		// Both retained only to match the runtime's constructor contract. Reading
		// them would be a mistake: this object deliberately has no storage and no
		// bindings of its own.
		void this.state;
		void this.env;
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === '/publish') {
			const event = (await request.json()) as RealtimeEvent;
			await this.#broadcast(event);
			return new Response(null, { status: 204 });
		}

		if (url.pathname === '/subscribe') return this.#subscribe(request);

		// Unreachable through the app — `remote.ts` is the only caller and it only
		// ever asks for these two paths. A 404 rather than a throw so a mistake
		// shows up as a bad response instead of an exception in the logs.
		return new Response('Not found', { status: 404 });
	}

	/**
	 * Fans an event out, without ever waiting for a reader.
	 *
	 * The writes are deliberately **not** awaited, and that is the whole point
	 * of this method's shape. A `TransformStream` writer's `write()` resolves
	 * only once the chunk has been *read*, so awaiting it means awaiting the
	 * slowest client on the other side of the internet — which would block the
	 * broadcast, and with it the `/publish` request that the sender's own HTTP
	 * request is sitting on. One stalled reader would stall sending for the
	 * whole partnership. (A test that awaited two writes before reading either
	 * deadlocked outright, which is how this was found.)
	 *
	 * Ordering per client is still guaranteed: writes queue on the writable in
	 * call order whether or not anyone awaits them.
	 */
	async #broadcast(event: RealtimeEvent): Promise<void> {
		const frame = encoder.encode(encodeSseEvent(event));
		// Copied first: `#drop` mutates the set we would otherwise be iterating.
		for (const writer of [...this.#writers]) {
			// A full queue means this client has stopped reading — asleep, offline,
			// or behind a proxy that buffers. Disconnect it rather than growing a
			// queue for it: it will reconnect when it can, and reconnecting
			// refetches unconditionally (see `live.ts`), so nothing is lost by
			// hanging up on it. Without this, a client that never reads is an
			// unbounded queue inside a 128 MB object.
			if (writer.desiredSize !== null && writer.desiredSize <= 0) {
				this.#drop(writer);
				continue;
			}
			// A closed stream is the normal end of every subscription, so a rejected
			// write is bookkeeping rather than an error worth logging.
			void writer.write(frame).catch(() => this.#drop(writer));
		}
	}

	#subscribe(request: Request): Response {
		// A queue deeper than the default 1, so `desiredSize` in `#broadcast` means
		// "this client has genuinely stopped reading" rather than "has not read
		// the frame sent a moment ago". Frames are a few dozen bytes, so the
		// memory this permits is negligible next to the cost of being wrong.
		const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>(
			{},
			{ highWaterMark: SSE_QUEUE_LIMIT }
		);
		const writer = writable.getWriter();
		this.#writers.add(writer);

		// Fired when the client hangs up — which the browser side does on purpose
		// every time the page is hidden, so this is the common case rather than an
		// edge one. Without it the writer would linger until the next publish.
		request.signal?.addEventListener('abort', () => this.#drop(writer));

		// Not awaited: `fetch` has to return the Response now, and the preamble is
		// the first thing down the pipe either way.
		void (async () => {
			try {
				await writer.write(encoder.encode(SSE_PREAMBLE));
				while (this.#writers.has(writer)) {
					await sleep(SSE_KEEPALIVE_MS);
					if (!this.#writers.has(writer)) break;
					await writer.write(encoder.encode(SSE_KEEPALIVE));
				}
			} catch {
				this.#drop(writer);
			}
		})();

		return new Response(readable, { headers: SSE_HEADERS });
	}

	#drop(writer: WritableStreamDefaultWriter<Uint8Array>): void {
		this.#writers.delete(writer);
		// The close can itself throw if the stream is already gone, which is
		// exactly the case that got us here.
		void writer.close().catch(() => {});
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
