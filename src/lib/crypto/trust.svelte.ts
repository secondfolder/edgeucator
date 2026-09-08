/**
 * The trust state of each open partnership, for the screens that render it.
 *
 * BROWSER ONLY — see the note at the top of `kdf.ts`.
 *
 * Module-level `$state` for the same reason `session.svelte.ts` has it: the
 * board and the thread view both need the same answer about the same
 * partnership, and accepting a key change on one must be visible on the other
 * without a reload. The pure comparison lives in `encryption.ts` and the
 * storage in `pins.ts`; this is only the reactive cache over them.
 */

import { pinBlocksSending } from '../encryption';
import { keyStore } from './keystore';
import { safetyNumber } from './fingerprint';
import { acceptPin, deviceTrust, verifyPin, OWN_KEY_PIN, type PartnershipTrust } from './pins';

/** What one partnership's trust looks like while it is being worked out. */
export type TrustView =
	/** Not worked out yet. Sending waits, so a send cannot race the check. */
	| { status: 'unknown' }
	/**
	 * This device cannot remember keys at all.
	 *
	 * Does **not** block sending, deliberately. The keystore already falls back
	 * to memory when IndexedDB refuses it, so reaching this means something more
	 * unusual — and refusing to let someone message their partner because their
	 * browser will not persist a pin would be the wrong trade. The UI says so
	 * instead.
	 */
	| { status: 'unavailable' }
	| ({ status: 'known'; safetyNumber: string | null } & PartnershipTrust);

const views = $state<Record<string, TrustView>>({});

/** Reactive: reading this in a template tracks it. */
export function trustFor(partnershipId: string): TrustView {
	return views[partnershipId] ?? { status: 'unknown' };
}

/**
 * Works out (and pins, on first sight) the keys for one partnership.
 *
 * Safe to call on every load of a messaging screen: the pin write only happens
 * for a key this device has not seen, and the read is one IndexedDB hit.
 */
export async function refreshTrust(
	userId: string,
	partnershipId: string,
	served: { mine: string | null; theirs: string | null }
): Promise<TrustView> {
	try {
		const trust = await deviceTrust(userId, partnershipId, served);
		// Only computable with both halves — a partner who has not set up
		// messaging has no number to compare, which `missing` already says.
		const number =
			served.mine && served.theirs ? await safetyNumber(served.mine, served.theirs) : null;

		const view: TrustView = { status: 'known', safetyNumber: number, ...trust };
		views[partnershipId] = view;
		return view;
	} catch (error) {
		// Left non-blocking on purpose — see the note on `unavailable`.
		console.error('could not check partner keys', error);
		views[partnershipId] = { status: 'unavailable' };
		return views[partnershipId];
	}
}

/**
 * Whether the composer may send.
 *
 * `unknown` blocks: the check is one IndexedDB read and a digest, so the wait
 * is imperceptible, and the alternative is a message encrypted to a key the
 * user was about to be warned about.
 */
export function trustAllowsSending(view: TrustView): boolean {
	if (view.status === 'unknown') return false;
	if (view.status === 'unavailable') return true;
	return !pinBlocksSending(view.partner) && !pinBlocksSending(view.own);
}

/** "We read the number to each other and it matched." */
export async function markVerified(
	userId: string,
	partnershipId: string,
	served: { mine: string | null; theirs: string | null }
): Promise<void> {
	if (!served.theirs) return;
	await verifyPin(await keyStore(), userId, partnershipId, served.theirs);
	await refreshTrust(userId, partnershipId, served);
}

/**
 * "This really is my partner's new key."
 *
 * Deliberately takes both recipients and re-pins whichever side actually
 * changed, because the two mismatches mean different things and the user is
 * only ever shown one of them at a time.
 */
export async function acceptKeyChange(
	userId: string,
	partnershipId: string,
	served: { mine: string | null; theirs: string | null },
	which: 'partner' | 'own'
): Promise<void> {
	const store = await keyStore();
	if (which === 'partner' && served.theirs) {
		await acceptPin(store, userId, partnershipId, served.theirs);
	}
	if (which === 'own' && served.mine) {
		await acceptPin(store, userId, OWN_KEY_PIN, served.mine);
	}
	await refreshTrust(userId, partnershipId, served);
}

/** Drops the cache — on sign-out, or a different account in the same tab. */
export function resetTrust(): void {
	for (const key of Object.keys(views)) delete views[key];
}
