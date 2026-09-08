import type { Notifier } from './index';
import type { RealtimeNamespace } from './binding';

/**
 * The production notifier: a Durable Object per partnership.
 *
 * This is the *worker* side — it talks to the object over `fetch`. The object
 * itself is `./durable-object.ts`, which is imported only by `worker.ts` so the
 * SvelteKit bundle never pulls the class in.
 *
 * The URL is a fiction. A Durable Object stub's `fetch` never makes a network
 * request; the host is ignored and only the path is read by the object's own
 * `fetch`. `https://realtime.invalid` makes that unmistakable — the `.invalid`
 * TLD is reserved precisely so it can never resolve, so nobody later mistakes
 * this for a service being called over the wire.
 */
const ROOM_ORIGIN = 'https://realtime.invalid';

export function createDurableObjectNotifier(namespace: RealtimeNamespace): Notifier {
	const room = (partnershipId: string) => namespace.get(namespace.idFromName(partnershipId));

	return {
		async publish(partnershipId, event) {
			try {
				await room(partnershipId).fetch(`${ROOM_ORIGIN}/publish`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(event)
				});
			} catch (error) {
				// Swallowed on purpose, and this is the whole reason `publish` is
				// declared as never throwing: the write this follows has already
				// committed. Turning a fan-out failure into a 500 would make the
				// client retry a send that actually succeeded, and the worst case
				// here is that the other device notices on its next navigation.
				console.error('could not publish a realtime event', error);
			}
		},

		async stream(partnershipId) {
			// The object's streaming Response is returned straight through. No
			// buffering step: reading it here would hold the whole stream in the
			// worker and defeat the point.
			return room(partnershipId).fetch(`${ROOM_ORIGIN}/subscribe`);
		}
	};
}
