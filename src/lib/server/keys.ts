import { and, eq, ne } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { Db } from './db';
import { partnerships, userKeyWraps, userKeys } from './db/schema';
import type { KeyWrapParams, KeyWrapType } from '../encryption';
import type { KeyWrapView, PartnerRecipientsView, UnlockBundleView } from '../types';

/**
 * Every database access for encryption keys.
 *
 * The whole file handles opaque strings. It stores a public recipient, a wrap
 * type, a JSON parameter blob it never inspects, and a ciphertext — and it
 * makes no decision based on any of them. Everything that understands those
 * values lives in `src/lib/crypto/`, which is browser-only and must never be
 * imported from here (see AGENTS.md).
 *
 * Kept out of the route files because the same reads are needed from the
 * unlock endpoint, the encryption settings screen, the partner page and the
 * messaging board.
 */

/** Only what a screen or the unlock flow needs. D1 bills on bytes read. */
const wrapColumns = {
	id: userKeyWraps.id,
	type: userKeyWraps.type,
	params: userKeyWraps.params,
	blob: userKeyWraps.blob,
	label: userKeyWraps.label,
	lastUsedAt: userKeyWraps.lastUsedAt,
	createdAt: userKeyWraps.createdAt
} as const;

export type NewWrapInput = {
	type: KeyWrapType;
	params: KeyWrapParams;
	blob: string;
	label?: string | null;
};

/**
 * Records a user's public recipient and their first wrap, together.
 *
 * One `db.batch()` and not two awaits: a recipient with no wrap is the one
 * genuinely dangerous half-state in this feature, because the obvious recovery
 * from it — generate a fresh identity — would silently orphan every message the
 * user had ever received. `db.transaction()` is not an option (invariant 3).
 *
 * Throws on a second call for the same user: `user_keys.user_id` is unique, and
 * that is deliberate. Overwriting a recipient is how history gets lost, so it
 * has to go through `replaceUserKeys`, which says so in its name.
 */
export async function putUserKeys(
	db: Db,
	userId: string,
	input: { recipient: string; wrap: NewWrapInput }
): Promise<void> {
	await db.batch([
		db.insert(userKeys).values({ userId, recipient: input.recipient }),
		db.insert(userKeyWraps).values({
			userId,
			type: input.wrap.type,
			params: input.wrap.params,
			blob: input.wrap.blob,
			label: input.wrap.label ?? null
		})
	]);
}

/** A user's own recipient, or null when they have not set up messaging. */
export async function getUserKeys(
	db: Db,
	userId: string
): Promise<{
	recipient: string;
	historyWarningAcknowledged: boolean;
	embedAutoLoad: boolean | null;
} | null> {
	const rows = await db
		.select({
			recipient: userKeys.recipient,
			historyWarningAckAt: userKeys.historyWarningAckAt,
			embedAutoLoad: userKeys.embedAutoLoad
		})
		.from(userKeys)
		.where(eq(userKeys.userId, userId))
		.limit(1);

	const row = rows[0];
	if (!row) return null;
	return {
		recipient: row.recipient,
		historyWarningAcknowledged: row.historyWarningAckAt !== null,
		embedAutoLoad: row.embedAutoLoad
	};
}

/** Every wrap for this user, newest last, for the unlock loop to try in turn. */
export async function listWrapsForUser(db: Db, userId: string): Promise<KeyWrapView[]> {
	return db
		.select(wrapColumns)
		.from(userKeyWraps)
		.where(eq(userKeyWraps.userId, userId))
		.orderBy(userKeyWraps.createdAt, userKeyWraps.id);
}

/**
 * Everything a cold device needs to unlock, in one read.
 *
 * Returned from its own endpoint rather than from the app shell's layout load:
 * in the layout it would add a D1 read and a few hundred bytes of ciphertext to
 * *every* page in the app, for something needed once per lock.
 */
export async function getUnlockBundle(db: Db, userId: string): Promise<UnlockBundleView> {
	const [keys, wraps] = await Promise.all([getUserKeys(db, userId), listWrapsForUser(db, userId)]);
	return {
		recipient: keys?.recipient ?? null,
		historyWarningAcknowledged: keys?.historyWarningAcknowledged ?? false,
		embedAutoLoad: keys?.embedAutoLoad ?? null,
		wraps
	};
}

/** Stores an explicit per-user choice for automatic URL embeds. */
export async function setEmbedAutoLoadPreference(
	db: Db,
	userId: string,
	enabled: boolean
): Promise<void> {
	await db.update(userKeys).set({ embedAutoLoad: enabled }).where(eq(userKeys.userId, userId));
}

/** Adds another way to unlock: a re-wrap under a new password, or a passkey. */
export async function addWrap(db: Db, userId: string, input: NewWrapInput): Promise<string> {
	const [row] = await db
		.insert(userKeyWraps)
		.values({
			userId,
			type: input.type,
			params: input.params,
			blob: input.blob,
			label: input.label ?? null
		})
		.returning({ id: userKeyWraps.id });
	return row.id;
}

/**
 * Retires every password wrap except the one just written.
 *
 * The last step of a password change, and it runs only after the credential
 * itself has been changed. Ordering matters and is the reason the table has no
 * unique index on (user_id, type): if the process dies before this call, the
 * user has two password wraps of which exactly one opens under their current
 * password, and unlock tries each. If it died before the credential change, the
 * old one still opens. Neither order loses the identity.
 */
export async function deleteOtherPasswordWraps(
	db: Db,
	userId: string,
	keepId: string
): Promise<void> {
	await db
		.delete(userKeyWraps)
		.where(
			and(
				eq(userKeyWraps.userId, userId),
				eq(userKeyWraps.type, 'password'),
				ne(userKeyWraps.id, keepId)
			)
		);
}

/** Removes one wrap — a revoked passkey, say. Scoped to its owner. */
export async function deleteWrap(db: Db, id: string, userId: string): Promise<boolean> {
	const rows = await db
		.delete(userKeyWraps)
		.where(and(eq(userKeyWraps.id, id), eq(userKeyWraps.userId, userId)))
		.returning({ id: userKeyWraps.id });
	return rows.length > 0;
}

/** Notes that a wrap actually opened. Displayed only; gates nothing. */
export async function touchWrap(db: Db, id: string, userId: string): Promise<void> {
	await db
		.update(userKeyWraps)
		.set({ lastUsedAt: new Date() })
		.where(and(eq(userKeyWraps.id, id), eq(userKeyWraps.userId, userId)));
}

/** Records the "I have written my password down" tick. Idempotent. */
export async function acknowledgeHistoryWarning(
	db: Db,
	userId: string,
	now: Date = new Date()
): Promise<void> {
	await db.update(userKeys).set({ historyWarningAckAt: now }).where(eq(userKeys.userId, userId));
}

/**
 * Replaces a user's identity outright, after a forgotten password.
 *
 * Destructive, and named so. The old identity is already unrecoverable at this
 * point — the wrap was the only copy and the password was the only key to it —
 * so this does not lose anything that was not already lost. What it does mean
 * is that every existing message becomes unreadable to this user until a
 * partner re-encrypts it; see `messaging.ts` and docs/encryption.md.
 *
 * One batch, because a recipient updated without its wrap replaced would leave
 * an account whose stored wrap cannot open its own new key.
 */
export async function replaceUserKeys(
	db: Db,
	userId: string,
	input: { recipient: string; wrap: NewWrapInput }
): Promise<void> {
	await db.batch([
		db
			.update(userKeys)
			.set({ recipient: input.recipient, historyWarningAckAt: null })
			.where(eq(userKeys.userId, userId)),
		db.delete(userKeyWraps).where(eq(userKeyWraps.userId, userId)),
		db.insert(userKeyWraps).values({
			userId,
			type: input.wrap.type,
			params: input.wrap.params,
			blob: input.wrap.blob,
			label: input.wrap.label ?? null
		})
	]);
}

// Two aliases of the same table: a partnership row reaches `user_keys` twice,
// so an unaliased join would be ambiguous. Same shape as the `inviter_user` /
// `invitee_user` pair in `server/partnerships.ts`.
const inviterKeys = alias(userKeys, 'inviter_keys');
const inviteeKeys = alias(userKeys, 'invitee_keys');

/**
 * Both public recipients for one partnership, from the viewer's side.
 *
 * Returns nulls rather than throwing when either person has no key yet, because
 * "my partner has not set up messaging" is an ordinary state the UI renders.
 * Returns null outright when the viewer is not a member, so a route can 404 on
 * it — consistent with the existing partner routes, where distinguishing 403
 * from 404 would confirm the id is real.
 *
 * LEFT joins on both sides on purpose: an inner join would make a partnership
 * disappear entirely just because one of the two had not generated a key.
 */
export async function getRecipientsForPartnership(
	db: Db,
	partnershipId: string,
	viewerId: string
): Promise<PartnerRecipientsView | null> {
	const rows = await db
		.select({
			inviterId: partnerships.inviterId,
			inviteeId: partnerships.inviteeId,
			inviterRecipient: inviterKeys.recipient,
			inviteeRecipient: inviteeKeys.recipient
		})
		.from(partnerships)
		.leftJoin(inviterKeys, eq(inviterKeys.userId, partnerships.inviterId))
		.leftJoin(inviteeKeys, eq(inviteeKeys.userId, partnerships.inviteeId))
		.where(and(eq(partnerships.id, partnershipId), eq(partnerships.status, 'accepted')))
		.limit(1);

	const row = rows[0];
	if (!row) return null;

	// Which recipient is "mine" flips with who is looking — the same trap as the
	// name columns (invariant 12), so it is resolved here and nowhere else.
	if (row.inviterId === viewerId) {
		return { mine: row.inviterRecipient, theirs: row.inviteeRecipient };
	}
	if (row.inviteeId === viewerId) {
		return { mine: row.inviteeRecipient, theirs: row.inviterRecipient };
	}
	return null;
}
