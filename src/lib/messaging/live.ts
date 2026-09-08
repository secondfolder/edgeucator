/**
 * Watching a partnership for changes, from the browser.
 *
 * BROWSER ONLY. Opens an `EventSource` against
 * `/api/partnerships/<id>/events` and calls back when anything changes. It
 * never reads the event's contents beyond deciding which cache key to
 * invalidate — the server sends metadata only, on purpose.
 *
 * ## The visibility gate is not an optimisation
 *
 * A Durable Object is billed at 128 MB × wall-clock for as long as it holds an
 * in-flight request, and only *hibernation-eligible* idleness is free —
 * hibernation needs the WebSocket Hibernation API, which SSE cannot use. So one
 * permanently-open stream is roughly 10,800 GB-s a day: about 83% of the free
 * plan's 13,000 GB-s daily allowance, for a single partnership sitting idle in a
 * background tab.
 *
 * Hanging up on `visibilitychange` turns that into "billed while someone is
 * actually looking". The step that makes it *safe* is the reconnect: on becoming
 * visible again this refetches once, unconditionally, before any event arrives.
 * Anything that happened while hung up was never delivered and never will be,
 * so without that call the gate would silently cost correctness instead of
 * money. Do not remove one without the other.
 *
 * ## Reconnection
 *
 * `EventSource` retries on its own, but eagerly and with no ceiling — a server
 * restart turns into a tight loop across every open tab. So `onerror` closes
 * the stream and reschedules by hand at `min(1000 · 2^n, 30_000)` with ±20%
 * jitter, and the attempt counter resets on the first message received rather
 * than on connect: a proxy that accepts the connection and then drops it would
 * otherwise never look like a failure.
 *
 * A stream that keeps failing falls back to slow polling while visible. That is
 * for the real case of an intermediary which buffers `text/event-stream`
 * indefinitely — the connection looks healthy and simply never delivers, which
 * no amount of reconnecting fixes.
 */

/** Matches the server's `RealtimeEvent`. Metadata only, by design. */
export type LiveEvent = {
	kind: 'thread' | 'message' | 'reaction' | 'restore';
	threadId?: string;
};

const MAX_BACKOFF_MS = 30_000;
/** After this many consecutive failures, stop trusting SSE and poll instead. */
const FALLBACK_AFTER_FAILURES = 4;
const POLL_INTERVAL_MS = 20_000;

export type LiveOptions = {
	partnershipId: string;
	/**
	 * Called for every change, and once on each reconnect with no event.
	 *
	 * Idempotent by requirement: it is called speculatively, so it must be safe
	 * to run when nothing has actually changed. `invalidate()` is.
	 */
	onChange: (event: LiveEvent | null) => void;
};

/**
 * Starts watching. Returns the teardown, for an `$effect`'s cleanup.
 *
 * Safe to call during SSR: it no-ops without a `window`, so a caller does not
 * need its own guard.
 */
export function watchPartnership(options: LiveOptions): () => void {
	if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
		return () => {};
	}

	const { partnershipId, onChange } = options;
	const url = `/api/partnerships/${partnershipId}/events`;

	let source: EventSource | null = null;
	let retry: ReturnType<typeof setTimeout> | undefined;
	let poll: ReturnType<typeof setInterval> | undefined;
	let failures = 0;
	let stopped = false;

	function clearTimers() {
		if (retry) clearTimeout(retry);
		if (poll) clearInterval(poll);
		retry = undefined;
		poll = undefined;
	}

	function disconnect() {
		clearTimers();
		source?.close();
		source = null;
	}

	function startPolling() {
		if (poll) return;
		poll = setInterval(() => {
			if (!stopped && document.visibilityState === 'visible') onChange(null);
		}, POLL_INTERVAL_MS);
	}

	function connect() {
		if (stopped || source || document.visibilityState !== 'visible') return;

		if (failures >= FALLBACK_AFTER_FAILURES) {
			startPolling();
			return;
		}

		source = new EventSource(url);

		source.onmessage = (message) => {
			// Reset here rather than in `onopen`: an intermediary can accept the
			// connection and then never forward anything, and only a delivered
			// message proves the whole path works.
			failures = 0;
			try {
				onChange(JSON.parse(message.data) as LiveEvent);
			} catch {
				// A frame we cannot parse still means *something* changed, and the
				// callback is a refetch either way.
				onChange(null);
			}
		};

		source.onerror = () => {
			// EventSource would retry on its own, immediately and forever, so the
			// connection is closed first and rescheduled below.
			disconnect();
			if (stopped) return;

			failures += 1;
			if (failures >= FALLBACK_AFTER_FAILURES) {
				startPolling();
				return;
			}

			const base = Math.min(1000 * 2 ** (failures - 1), MAX_BACKOFF_MS);
			// ±20% so a server coming back up does not get every client at once.
			const jittered = base * (0.8 + Math.random() * 0.4);
			retry = setTimeout(connect, jittered);
		};
	}

	function onVisibilityChange() {
		if (stopped) return;
		if (document.visibilityState === 'visible') {
			// The unconditional refetch that makes hanging up safe — see the note
			// at the top. It comes BEFORE reconnecting, so the gap is closed even if
			// the connection itself fails.
			onChange(null);
			connect();
		} else {
			disconnect();
		}
	}

	document.addEventListener('visibilitychange', onVisibilityChange);
	connect();

	return () => {
		stopped = true;
		document.removeEventListener('visibilitychange', onVisibilityChange);
		disconnect();
	};
}
