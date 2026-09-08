/**
 * Trust on first use: what public keys this device has seen before.
 *
 * The server hands you your partner's public recipient, so a dishonest server
 * could hand you its own instead and read everything you send. Nothing in the
 * protocol prevents that — the mitigation is that a *substitution* is visible,
 * because this device remembers what it saw the first time and says so loudly
 * when the answer changes.
 *
 * Two things worth being clear about, because they look like flaws otherwise:
 *
 * - **The blocking is client-side only, necessarily.** The server is the
 *   adversary in this threat model, so it cannot be asked to enforce a warning
 *   about itself. This is not the thing AGENTS.md invariant 14 forbids: that is
 *   about a *permission* being enforced in the browser, which is still
 *   forbidden. There is no server-side version of this check to skip.
 * - **Pins are per-device.** A new phone has seen nothing, so it trusts what it
 *   is first told, which is what "on first use" means. Surviving a device
 *   change needs `user_keys.sealed_pins` (the pin list encrypted to your own
 *   key), which is a noted follow-up. Until then the UI says when a pin was
 *   first seen, so "first seen a moment ago" is not mistaken for "first seen
 *   two years ago".
 *
 * The store is passed in rather than reached for, so this is testable in node
 * against a plain Map without IndexedDB. `deviceTrust` is the convenience
 * wrapper the app uses.
 */

import { pinStateFor, type PinRecord, type PinState } from '../encryption';
import { keyStore, type KeyStore, type PinRow } from './keystore';

/**
 * The pseudo-partnership id under which a user's **own** recipient is pinned.
 *
 * Your own key is pinned as well as your partner's, and that is not
 * paranoia-for-its-own-sake: a server that swapped *your* recipient would make
 * every message your partner sends undecryptable by you, which without a pin
 * looks like data loss rather than an attack. Pinned, it is a loud error with a
 * cause attached.
 *
 * Safe as a literal because every real partnership id is a UUID, so no
 * partnership can ever collide with it.
 */
export const OWN_KEY_PIN = 'self';

/** Pin rows are keyed by user *and* partnership, so one device can hold several accounts. */
export function pinRowId(userId: string, partnershipId: string): string {
	return `${userId}:${partnershipId}`;
}

function toRecord(row: PinRow): PinRecord {
	return {
		partnershipId: row.partnershipId,
		recipient: row.recipient,
		pinnedAt: row.pinnedAt,
		verifiedAt: row.verifiedAt
	};
}

/** Everything this device has pinned for one user, by partnership id. */
export async function readPins(store: KeyStore, userId: string): Promise<Map<string, PinRecord>> {
	const rows = await store.getPins(userId);
	return new Map(rows.map((row) => [row.partnershipId, toRecord(row)]));
}

/** Writes a pin, replacing whatever was there. Verification never carries over. */
export async function writePin(
	store: KeyStore,
	userId: string,
	partnershipId: string,
	recipient: string,
	options: { verified?: boolean; now?: number } = {}
): Promise<PinRecord> {
	const now = options.now ?? Date.now();
	const row: PinRow = {
		id: pinRowId(userId, partnershipId),
		userId,
		partnershipId,
		recipient,
		pinnedAt: now,
		verifiedAt: options.verified ? now : null
	};
	await store.putPin(row);
	return toRecord(row);
}

/**
 * Marks an already-pinned key as compared out of band.
 *
 * Refuses when the recipient does not match what is pinned, rather than
 * quietly re-pinning: "I compared the number" is a statement about a specific
 * key, and applying it to a different one would launder a key change into a
 * verification. Accepting a change is a separate, deliberate act — see
 * `acceptPin`.
 */
export async function verifyPin(
	store: KeyStore,
	userId: string,
	partnershipId: string,
	recipient: string,
	now: number = Date.now()
): Promise<PinRecord | null> {
	const pins = await readPins(store, userId);
	const pinned = pins.get(partnershipId);
	if (!pinned || pinned.recipient !== recipient) return null;

	const row: PinRow = {
		id: pinRowId(userId, partnershipId),
		userId,
		partnershipId,
		recipient,
		// The original sighting is kept: how long this device has known the key is
		// the useful fact, and overwriting it with "now" would erase it.
		pinnedAt: pinned.pinnedAt,
		verifiedAt: now
	};
	await store.putPin(row);
	return toRecord(row);
}

/**
 * Accepts a key that does not match the pin — after the user said to.
 *
 * The new pin is **unverified** whatever the old one was. A key change resets
 * the question; carrying verification across it would defeat the point of
 * having pinned anything.
 */
export async function acceptPin(
	store: KeyStore,
	userId: string,
	partnershipId: string,
	recipient: string,
	now: number = Date.now()
): Promise<PinRecord> {
	return writePin(store, userId, partnershipId, recipient, { now });
}

/**
 * What this device thinks of the two keys in a partnership.
 *
 * Pins anything seen for the first time as a side effect, which is what makes
 * this "on first use" rather than a prompt on every load. The returned state
 * for a fresh sighting is still `new`, so the UI can say so.
 */
export type PartnershipTrust = {
	/** Their key, as pinned against what the server just served. */
	partner: PinState;
	/** Your own. `changed` here means the server swapped *your* recipient. */
	own: PinState;
};

export async function evaluateTrust(
	store: KeyStore,
	userId: string,
	partnershipId: string,
	served: { mine: string | null; theirs: string | null },
	now: number = Date.now()
): Promise<PartnershipTrust> {
	const pins = await readPins(store, userId);

	const partner = pinStateFor(pins.get(partnershipId), served.theirs);
	const own = pinStateFor(pins.get(OWN_KEY_PIN), served.mine);

	// Pin on first sight, both sides. Never re-pin: a mismatch is the signal
	// this whole module exists to produce, and overwriting it would erase it.
	if (partner.kind === 'new' && served.theirs) {
		await writePin(store, userId, partnershipId, served.theirs, { now });
	}
	if (own.kind === 'new' && served.mine) {
		await writePin(store, userId, OWN_KEY_PIN, served.mine, { now });
	}

	return { partner, own };
}

/** The same, against this device's real store. */
export async function deviceTrust(
	userId: string,
	partnershipId: string,
	served: { mine: string | null; theirs: string | null }
): Promise<PartnershipTrust> {
	return evaluateTrust(await keyStore(), userId, partnershipId, served);
}
