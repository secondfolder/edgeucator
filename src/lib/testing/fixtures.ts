import { eq } from 'drizzle-orm';
import type { Db } from '../server/db';
import { partnerships, user } from '../server/db/schema';
import { acceptInvite, createInvite } from '../server/partnerships';
import type { ControlAnswer } from '../partnership';
import { controlFromAnswer } from '../partnership';

/**
 * Fixtures for the partners tests.
 *
 * Users are inserted straight into the `user` table rather than going through
 * Better Auth: nothing under test reads a password, a session or an account
 * row, and booting the auth instance would drag in `sveltekitCookies`, which
 * needs a live request context. The e2e suite covers the real signup path.
 */

let counter = 0;

export type TestUser = { id: string; name: string; email: string; image: string | null };

export async function createTestUser(db: Db, overrides: Partial<TestUser> = {}): Promise<TestUser> {
	counter += 1;
	const row: TestUser = {
		id: overrides.id ?? `user-${counter}`,
		name: overrides.name ?? `Test User ${counter}`,
		email: overrides.email ?? `user-${counter}@example.test`,
		image: overrides.image ?? null
	};

	await db.insert(user).values({
		id: row.id,
		name: row.name,
		email: row.email,
		emailVerified: false,
		image: row.image,
		createdAt: new Date(),
		updatedAt: new Date()
	});

	return row;
}

/** A pending invite, as `/settings/partners/new` would create it. */
export async function createTestInvite(
	db: Db,
	inviter: TestUser,
	options: {
		partnerName?: string;
		yourName?: string;
		relationshipLabel?: string | null;
		/** Answered from the inviter's side, exactly as the form asks it. */
		control?: ControlAnswer;
		now?: Date;
	} = {}
) {
	return createInvite(
		db,
		{
			inviterId: inviter.id,
			inviteeName: options.partnerName ?? 'Them',
			inviterName: options.yourName ?? 'You',
			relationshipLabel: options.relationshipLabel ?? null,
			control: controlFromAnswer(options.control ?? 'mix', 'inviter')
		},
		options.now ?? new Date()
	);
}

/** A fully linked pair, created through the real invite → accept path. */
export async function createTestPartnership(
	db: Db,
	inviter: TestUser,
	invitee: TestUser,
	options: Parameters<typeof createTestInvite>[2] = {}
): Promise<{ id: string }> {
	const invite = await createTestInvite(db, inviter, options);
	const result = await acceptInvite(db, { token: invite.inviteToken, inviteeId: invitee.id });
	if (!result.ok) throw new Error(`fixture could not accept invite: ${result.reason}`);
	return { id: result.id };
}

/** Pushes a pending invite's expiry into the past. */
export async function expireInvite(db: Db, partnershipId: string): Promise<void> {
	await db
		.update(partnerships)
		.set({ inviteExpiresAt: new Date(Date.now() - 1000) })
		.where(eq(partnerships.id, partnershipId));
}

/** The raw row, for assertions about columns the view layer hides. */
export async function readPartnershipRow(db: Db, id: string) {
	const rows = await db.select().from(partnerships).where(eq(partnerships.id, id)).limit(1);
	return rows[0];
}
