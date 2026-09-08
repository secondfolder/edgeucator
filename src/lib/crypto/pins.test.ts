import { describe, expect, it } from 'vitest';
import type { CachedIdentity, KeyStore, PinRow } from './keystore';
import {
	OWN_KEY_PIN,
	acceptPin,
	evaluateTrust,
	pinRowId,
	readPins,
	verifyPin,
	writePin
} from './pins';

/**
 * Trust-on-first-use, against a plain Map.
 *
 * `pins.ts` takes its store as an argument precisely so this can run in node
 * with no IndexedDB and no WebCrypto — the interesting behaviour is *when* a
 * key gets pinned and when it deliberately does not, which is exactly the part
 * a browser adds nothing to.
 */
function fakeStore(): KeyStore & { rows: Map<string, PinRow> } {
	const rows = new Map<string, PinRow>();
	const identities = new Map<string, CachedIdentity>();
	return {
		rows,
		durable: true,
		async getIdentity(userId) {
			return identities.get(userId);
		},
		async putIdentity(value) {
			identities.set(value.userId, value);
		},
		async getPins(userId) {
			return [...rows.values()].filter((row) => row.userId === userId);
		},
		async putPin(row) {
			rows.set(row.id, row);
		},
		async clear(userId) {
			identities.delete(userId);
			for (const [id, row] of rows) if (row.userId === userId) rows.delete(id);
		}
	};
}

const ada = 'user-ada';
const partnership = '11111111-1111-4111-8111-111111111111';
const theirKey = 'age1theirs';
const myKey = 'age1mine';

describe('pinRowId', () => {
	it('scopes a pin to one user, so two accounts on one device cannot collide', () => {
		expect(pinRowId('a', partnership)).not.toBe(pinRowId('b', partnership));
	});
});

describe('evaluateTrust', () => {
	it('pins both keys on first sight and reports them as new', async () => {
		const store = fakeStore();
		const trust = await evaluateTrust(store, ada, partnership, { mine: myKey, theirs: theirKey });

		// `new`, not `pinned`: the caller has to be able to say "first seen just
		// now", which is the only honest thing to show for a key nothing has
		// vouched for.
		expect(trust.partner).toEqual({ kind: 'new' });
		expect(trust.own).toEqual({ kind: 'new' });

		const pins = await readPins(store, ada);
		expect(pins.get(partnership)?.recipient).toBe(theirKey);
		expect(pins.get(OWN_KEY_PIN)?.recipient).toBe(myKey);
	});

	it('reports a matching key as pinned on the second sight', async () => {
		const store = fakeStore();
		const served = { mine: myKey, theirs: theirKey };
		await evaluateTrust(store, ada, partnership, served, 1000);
		const trust = await evaluateTrust(store, ada, partnership, served, 2000);

		expect(trust.partner).toEqual({ kind: 'pinned', pinnedAt: 1000 });
		// The original sighting, not the latest: how long this device has known
		// the key is the fact worth showing.
		expect(trust.own).toEqual({ kind: 'pinned', pinnedAt: 1000 });
	});

	/**
	 * The test this module exists for. A silent re-pin would erase the only
	 * evidence that anything changed, so the mismatch has to survive the very
	 * call that notices it.
	 */
	it('reports a substituted partner key as changed, and does NOT re-pin it', async () => {
		const store = fakeStore();
		await evaluateTrust(store, ada, partnership, { mine: myKey, theirs: theirKey }, 1000);

		const trust = await evaluateTrust(
			store,
			ada,
			partnership,
			{ mine: myKey, theirs: 'age1attacker' },
			2000
		);

		expect(trust.partner).toMatchObject({ kind: 'changed', served: 'age1attacker' });
		expect((await readPins(store, ada)).get(partnership)?.recipient).toBe(theirKey);

		// And it stays changed on every subsequent load, rather than settling.
		const again = await evaluateTrust(
			store,
			ada,
			partnership,
			{ mine: myKey, theirs: 'age1attacker' },
			3000
		);
		expect(again.partner.kind).toBe('changed');
	});

	it('notices a swap of the viewer’s own key independently of the partner’s', async () => {
		const store = fakeStore();
		await evaluateTrust(store, ada, partnership, { mine: myKey, theirs: theirKey }, 1000);

		const trust = await evaluateTrust(
			store,
			ada,
			partnership,
			{ mine: 'age1notmine', theirs: theirKey },
			2000
		);

		expect(trust.own.kind).toBe('changed');
		// The partner is untouched — the two are separate pins, so a server
		// swapping one cannot be mistaken for the other.
		expect(trust.partner.kind).toBe('pinned');
	});

	it('treats a partner with no keys as missing rather than pinning null', async () => {
		const store = fakeStore();
		const trust = await evaluateTrust(store, ada, partnership, { mine: myKey, theirs: null });

		expect(trust.partner).toEqual({ kind: 'missing' });
		expect((await readPins(store, ada)).has(partnership)).toBe(false);
	});

	it('keeps one account’s pins away from another on the same device', async () => {
		const store = fakeStore();
		await evaluateTrust(store, ada, partnership, { mine: myKey, theirs: theirKey });
		const other = await evaluateTrust(store, 'user-jun', partnership, {
			mine: theirKey,
			theirs: myKey
		});

		// A second account sees everything for the first time, even though the
		// same partnership id is pinned in the same store.
		expect(other.partner).toEqual({ kind: 'new' });
	});
});

describe('verifyPin', () => {
	it('marks a matching key verified, keeping the original sighting', async () => {
		const store = fakeStore();
		await writePin(store, ada, partnership, theirKey, { now: 1000 });

		const record = await verifyPin(store, ada, partnership, theirKey, 5000);
		expect(record).toMatchObject({ pinnedAt: 1000, verifiedAt: 5000 });

		const trust = await evaluateTrust(store, ada, partnership, { mine: null, theirs: theirKey });
		expect(trust.partner).toEqual({ kind: 'verified', verifiedAt: 5000 });
	});

	/**
	 * "I compared the number" is a statement about one specific key. Applying it
	 * to a different one would launder a key substitution into a verification,
	 * which is strictly worse than not offering verification at all.
	 */
	it('refuses to verify a key that is not the pinned one', async () => {
		const store = fakeStore();
		await writePin(store, ada, partnership, theirKey, { now: 1000 });

		await expect(verifyPin(store, ada, partnership, 'age1attacker')).resolves.toBeNull();
		expect((await readPins(store, ada)).get(partnership)).toMatchObject({
			recipient: theirKey,
			verifiedAt: null
		});
	});
});

describe('acceptPin', () => {
	it('replaces a pin and drops verification, so a change resets the question', async () => {
		const store = fakeStore();
		await writePin(store, ada, partnership, theirKey, { now: 1000, verified: true });
		expect((await readPins(store, ada)).get(partnership)?.verifiedAt).toBe(1000);

		await acceptPin(store, ada, partnership, 'age1new', 9000);

		const pinned = (await readPins(store, ada)).get(partnership);
		expect(pinned).toMatchObject({ recipient: 'age1new', pinnedAt: 9000, verifiedAt: null });

		// Carrying verification across a key change would defeat the point of
		// having pinned anything, so the new key comes back merely `pinned`.
		const trust = await evaluateTrust(store, ada, partnership, { mine: null, theirs: 'age1new' });
		expect(trust.partner).toEqual({ kind: 'pinned', pinnedAt: 9000 });
	});
});
