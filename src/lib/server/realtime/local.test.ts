import { describe, expect, it } from 'vitest';
import { SSE_PREAMBLE, encodeSseEvent } from './index';
import { createLocalNotifier, localRoomSize } from './local';

/**
 * The development notifier's fan-out.
 *
 * Worth testing rather than treating as a stub, because it is the
 * implementation the entire Playwright suite runs against — the Durable Object
 * only exists under `wrangler dev` and in production. If this file is wrong,
 * every live-update test passes or fails for the wrong reason.
 *
 * The module keeps one process-wide table, so each test uses its own
 * partnership id and cancels its readers; a leaked reader would hold a
 * keepalive interval open and stall the run.
 */

const decoder = new TextDecoder();

/** Subscribes and returns a reader plus a way to let go of it. */
async function subscribe(notifier: ReturnType<typeof createLocalNotifier>, id: string) {
	const response = await notifier.stream(id);
	expect(response.headers.get('content-type')).toBe('text/event-stream');
	const reader = response.body!.getReader();

	// Every stream opens with a comment frame. Not cosmetic: EventSource does not
	// fire `onopen` until something arrives, so without it a client cannot tell
	// "connected and idle" from "still connecting".
	const first = await reader.read();
	expect(decoder.decode(first.value)).toBe(SSE_PREAMBLE);

	return { reader, release: () => reader.cancel() };
}

describe('the local notifier', () => {
	it('delivers an event to every subscriber of that partnership', async () => {
		const notifier = createLocalNotifier();
		const a = await subscribe(notifier, 'p-fanout');
		const b = await subscribe(notifier, 'p-fanout');

		await notifier.publish('p-fanout', { kind: 'message', threadId: 't-1' });

		for (const side of [a, b]) {
			const frame = await side.reader.read();
			expect(decoder.decode(frame.value)).toBe(
				encodeSseEvent({ kind: 'message', threadId: 't-1' })
			);
		}

		await a.release();
		await b.release();
	});

	/**
	 * The isolation that makes one object per partnership meaningful. A leak here
	 * would tell one couple, in real time, exactly when another was messaging.
	 */
	it('never delivers across partnerships', async () => {
		const notifier = createLocalNotifier();
		const mine = await subscribe(notifier, 'p-mine');
		const theirs = await subscribe(notifier, 'p-theirs');

		await notifier.publish('p-theirs', { kind: 'thread' });

		// Their stream got it...
		const got = await theirs.reader.read();
		expect(decoder.decode(got.value)).toBe(encodeSseEvent({ kind: 'thread' }));

		// ...and mine has nothing pending. Raced against a resolved promise rather
		// than a timer, because a `read()` on an idle stream never settles and a
		// timeout would just make this test slow.
		const pending = await Promise.race([
			mine.reader.read().then(() => 'delivered'),
			Promise.resolve('nothing')
		]);
		expect(pending).toBe('nothing');

		await mine.release();
		await theirs.release();
	});

	it('forgets a subscriber that hangs up, and empties the room', async () => {
		const notifier = createLocalNotifier();
		const one = await subscribe(notifier, 'p-hangup');
		const two = await subscribe(notifier, 'p-hangup');
		expect(localRoomSize('p-hangup')).toBe(2);

		await one.release();
		expect(localRoomSize('p-hangup')).toBe(1);

		await two.release();
		// The room itself goes, not just its members — otherwise a long-lived dev
		// server accumulates an empty Set per partnership ever opened.
		expect(localRoomSize('p-hangup')).toBe(0);
	});

	/**
	 * `publish` is declared as never throwing, and this is the common case: the
	 * sender's own request publishes whether or not anyone is listening.
	 */
	it('is a no-op when nobody is listening', async () => {
		const notifier = createLocalNotifier();
		await expect(notifier.publish('p-empty', { kind: 'reaction' })).resolves.toBeUndefined();
	});
});
