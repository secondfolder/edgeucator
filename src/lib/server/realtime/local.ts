import {
	SSE_HEADERS,
	SSE_KEEPALIVE,
	SSE_KEEPALIVE_MS,
	SSE_PREAMBLE,
	encodeSseEvent,
	type Notifier,
	type RealtimeEvent
} from './index';

/**
 * The development notifier: one `Map`, in one process.
 *
 * Correct rather than a stub, which is the point — `npm run dev` and the
 * Playwright suite exercise the same client code, the same endpoint and the
 * same SSE framing as production, and only the fan-out differs. Kept
 * module-level because `vite dev` is a single Node process, so every request
 * genuinely shares this table.
 *
 * `dev.ts` reaches this only behind `if (dev)`, which is a build-time constant,
 * so the whole file is dead-code-eliminated from the worker bundle.
 */

const encoder = new TextEncoder();

/** partnershipId → the open streams watching it. */
const rooms = new Map<string, Set<ReadableStreamDefaultController<Uint8Array>>>();

export function createLocalNotifier(): Notifier {
	return {
		async publish(partnershipId, event) {
			const room = rooms.get(partnershipId);
			if (!room) return;

			const frame = encoder.encode(encodeSseEvent(event));
			// A copy, because a failed enqueue removes the controller from the set
			// we would otherwise be iterating.
			for (const controller of [...room]) {
				try {
					controller.enqueue(frame);
				} catch {
					// The client has gone. Nothing to report — a closed stream is the
					// normal end of every subscription, not an error.
					room.delete(controller);
				}
			}
			if (room.size === 0) rooms.delete(partnershipId);
		},

		async stream(partnershipId) {
			let own: ReadableStreamDefaultController<Uint8Array> | undefined;
			let keepalive: ReturnType<typeof setInterval> | undefined;

			const drop = () => {
				if (keepalive) clearInterval(keepalive);
				const room = rooms.get(partnershipId);
				if (!room || !own) return;
				room.delete(own);
				if (room.size === 0) rooms.delete(partnershipId);
			};

			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					own = controller;
					let room = rooms.get(partnershipId);
					if (!room) rooms.set(partnershipId, (room = new Set()));
					room.add(controller);

					controller.enqueue(encoder.encode(SSE_PREAMBLE));
					keepalive = setInterval(() => {
						try {
							controller.enqueue(encoder.encode(SSE_KEEPALIVE));
						} catch {
							drop();
						}
					}, SSE_KEEPALIVE_MS);
				},
				// Fired when the client hangs up, which is what the visibility gate on
				// the browser side does deliberately and often.
				cancel: drop
			});

			return new Response(body, { headers: SSE_HEADERS });
		}
	};
}

/** Exported for the tests, which need to observe fan-out without HTTP. */
export function localRoomSize(partnershipId: string): number {
	return rooms.get(partnershipId)?.size ?? 0;
}

export type { RealtimeEvent };
