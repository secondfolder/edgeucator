import { and, eq, notLike } from 'drizzle-orm';
import type { Db } from './db';
import { partnershipRewards, partnershipTasks, selfRewards, selfTasks } from './db/schema';
import { requireRewardMembership } from './rewards';
import { requireTaskMembership } from './tasks';

/**
 * LEGACY-RICHTEXT — converts pre-rich-text descriptions in place.
 *
 * Deleted once nothing is left in the old form; see docs/temporary-code.md.
 *
 * Unlike message bodies, the server *can* read these, so this could have been a
 * one-shot script. It is client-driven for the same reason the message path is:
 * one mechanism to understand and one to delete.
 *
 * **Permission is re-checked here, against the database, for every row.** The
 * client says which rows it converted; it does not get to say whether it was
 * allowed to — AGENTS.md invariant 14, the same posture as the task edit
 * action. A self task or reward is editable only by its owner; a partnership
 * one only by the side that controls it.
 */

/**
 * A document always starts `{"root"`, so anything that does not is legacy. The
 * check stays in SQL, which is what makes each update atomic: a row another
 * device converted first is simply not matched.
 */
const LEGACY_PREFIX = '{"root"%';

export type LegacyDescriptionKind =
	'self-task' | 'self-reward' | 'partnership-task' | 'partnership-reward';

export type LegacyDescriptionUpdate = {
	kind: LegacyDescriptionKind;
	id: string;
	/** Present only for the partnership kinds. */
	partnershipId?: string;
	/** The converted document, already validated by the endpoint's schema. */
	description: string;
};

export async function migrateLegacyDescriptions(
	db: Db,
	userId: string,
	updates: LegacyDescriptionUpdate[]
): Promise<number> {
	let updated = 0;
	for (const update of updates) {
		if (await applyOne(db, userId, update)) updated += 1;
	}
	return updated;
}

async function applyOne(db: Db, userId: string, update: LegacyDescriptionUpdate): Promise<boolean> {
	/**
	 * Every statement also carries `description not like '{"root"%'`, so a row
	 * converted by another device in the meantime is left alone. That makes the
	 * whole operation one-way and idempotent, the same property
	 * `body_format = 'plain'` gives the message path.
	 */
	switch (update.kind) {
		case 'self-task': {
			const rows = await db
				.update(selfTasks)
				.set({ description: update.description })
				.where(
					and(
						eq(selfTasks.id, update.id),
						eq(selfTasks.ownerId, userId),
						notLike(selfTasks.description, LEGACY_PREFIX)
					)
				)
				.returning({ id: selfTasks.id });
			return rows.length > 0;
		}
		case 'self-reward': {
			const rows = await db
				.update(selfRewards)
				.set({ description: update.description })
				.where(
					and(
						eq(selfRewards.id, update.id),
						eq(selfRewards.ownerId, userId),
						notLike(selfRewards.description, LEGACY_PREFIX)
					)
				)
				.returning({ id: selfRewards.id });
			return rows.length > 0;
		}
		case 'partnership-task': {
			if (!update.partnershipId) return false;
			// The timezone argument only shapes the view this returns; the
			// `canManage` flag it is consulted for does not depend on it.
			const membership = await requireTaskMembership(db, update.partnershipId, userId, 'UTC');
			if (!membership?.canManage) return false;
			const rows = await db
				.update(partnershipTasks)
				.set({ description: update.description })
				.where(
					and(
						eq(partnershipTasks.id, update.id),
						eq(partnershipTasks.partnershipId, update.partnershipId),
						notLike(partnershipTasks.description, LEGACY_PREFIX)
					)
				)
				.returning({ id: partnershipTasks.id });
			return rows.length > 0;
		}
		case 'partnership-reward': {
			if (!update.partnershipId) return false;
			const membership = await requireRewardMembership(db, update.partnershipId, userId);
			if (!membership?.canManage) return false;
			const rows = await db
				.update(partnershipRewards)
				.set({ description: update.description })
				.where(
					and(
						eq(partnershipRewards.id, update.id),
						eq(partnershipRewards.partnershipId, update.partnershipId),
						notLike(partnershipRewards.description, LEGACY_PREFIX)
					)
				)
				.returning({ id: partnershipRewards.id });
			return rows.length > 0;
		}
	}
}
