import { afterEach, describe, expect, it, vi } from 'vitest';
import { SSE_KEEPALIVE, SSE_KEEPALIVE_MS, SSE_PREAMBLE, encodeSseEvent } from './index';
import { RealtimeRoom } from './durable-object';

/**
 * The Durable Object class, exercised directly.
 *
 * This is the one part of the feature that no other level reaches. `vite dev`
 * and the whole Playwright suite use the in-process notifier in `local.ts`; the
 * Durable Object only runs under `wrangler dev` and in production, where the
 * Playwright suite does not point. So without these tests the class would ship
 * having been verified by nothing but "wrangler listed the binding".
 *
 * It runs in plain node because the class deliberately uses no Cloudflare API
 * at all — no storage, no bindings, and `(state, env)` are accepted and then
 * ignored. Everything it touches (`Request`, `Response`, `TransformStream`) is
 * standard and present in node 18+. That is a consequence of the design rather
 * than luck: an object that held storage could not be tested this way.
 *
 * Fake timers throughout, because a subscription arms a 25-second keepalive
 * loop and a real one would either hang the run or leak a handle past it.
 */

const decoder = new TextDecoder();
const ORIGIN = 'https://realtime.invalid';

function room() {
	return new RealtimeRoom({}, {});
}

async function subscribe(instance: RealtimeRoom) {
	const response = await instance.fetch(new Request(`${ORIGIN}/subscribe`));
	expect(response.headers.get('content-type')).toBe('text/event-stream');
	const reader = response.body!.getReader();

	// The preamble proves the stream is live. EventSource does not fire `onopen`
	// until something arrives, so a client's reconnect backoff depends on it.
	expect(decoder.decode((await reader.read()).value)).toBe(SSE_PREAMBLE);
	return reader;
}

function publish(instance: RealtimeRoom, body: unknown) {
	return instance.fetch(
		new Request(`${ORIGIN}/publish`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		})
	);
}

afterEach(() => {
	vi.useRealTimers();
});

describe('RealtimeRoom', () => {
	it('broadcasts a published event to every open stream', async () => {
		vi.useFakeTimers();
		const instance = room();
		const a = await subscribe(instance);
		const b = await subscribe(instance);

		const response = await publish(instance, { kind: 'message', threadId: 't-7' });
		expect(response.status).toBe(204);

		for (const reader of [a, b]) {
			expect(decoder.decode((await reader.read()).value)).toBe(
				encodeSseEvent({ kind: 'message', threadId: 't-7' })
			);
		}

		await a.cancel();
		await b.cancel();
	});

	it('accepts a publish with nobody listening', async () => {
		vi.useFakeTimers();
		const instance = room();
		expect((await publish(instance, { kind: 'thread' })).status).toBe(204);
	});

	/**
	 * The browser side hangs up every time the page is hidden — see the note in
	 * `live.ts` about that being a billing necessity rather than an optimisation
	 * — so a dropped subscriber is the common case, not an edge one. If it were
	 * not cleaned up, a long-lived room would broadcast to a growing set of dead
	 * writers.
	 */
	it('drops a stream that has hung up, and keeps serving the rest', async () => {
		vi.useFakeTimers();
		const instance = room();
		const staying = await subscribe(instance);
		const leaving = await subscribe(instance);

		await leaving.cancel();

		// The publish must still succeed, and must still reach the live one. A
		// broadcast that threw on the dead writer would take the whole fan-out
		// with it, so this is the assertion that matters.
		expect((await publish(instance, { kind: 'reaction' })).status).toBe(204);
		expect(decoder.decode((await staying.read()).value)).toBe(encodeSseEvent({ kind: 'reaction' }));

		await staying.cancel();
	});

	it('sends a keepalive so an idle stream is not reaped by a proxy', async () => {
		vi.useFakeTimers();
		const instance = room();
		const reader = await subscribe(instance);

		await vi.advanceTimersByTimeAsync(SSE_KEEPALIVE_MS + 1);

		expect(decoder.decode((await reader.read()).value)).toBe(SSE_KEEPALIVE);
		await reader.cancel();
	});

	it('404s an unknown path rather than throwing', async () => {
		vi.useFakeTimers();
		const instance = room();
		const response = await instance.fetch(new Request(`${ORIGIN}/nope`));
		expect(response.status).toBe(404);
	});
});
