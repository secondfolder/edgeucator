import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from './db';
import {
	partnershipRewardClaims,
	partnershipRewardCredits,
	partnershipRewards,
	partnerships,
	selfRewardClaims,
	selfRewardCredits,
	selfRewards
} from './db/schema';
import { canClaimFromPartnership, type RewardInput } from '../rewards';
import type {
	HomePartnerRewardsSectionView,
	PartnershipRewardClaimView,
	PartnershipRewardView,
	PartnerView,
	RewardHistoryView,
	SelfRewardsSectionView,
	SelfRewardView
} from '../types';
import { getPartnershipForUser } from './partnerships';

const selfRewardColumns = {
	id: selfRewards.id,
	title: selfRewards.title,
	description: selfRewards.description,
	cost: selfRewards.cost,
	active: selfRewards.active,
	createdAt: selfRewards.createdAt,
	updatedAt: selfRewards.updatedAt
} as const;

const partnershipRewardColumns = {
	id: partnershipRewards.id,
	partnershipId: partnershipRewards.partnershipId,
	createdByUserId: partnershipRewards.createdByUserId,
	title: partnershipRewards.title,
	description: partnershipRewards.description,
	cost: partnershipRewards.cost,
	active: partnershipRewards.active,
	createdAt: partnershipRewards.createdAt,
	updatedAt: partnershipRewards.updatedAt
} as const;

const rewardHistoryColumns = {
	id: selfRewardClaims.id,
	rewardTitle: selfRewardClaims.rewardTitle,
	rewardDescription: selfRewardClaims.rewardDescription,
	rewardCost: selfRewardClaims.rewardCost,
	createdAt: selfRewardClaims.createdAt
} as const;

const partnershipRewardHistoryColumns = {
	id: partnershipRewardClaims.id,
	claimedByUserId: partnershipRewardClaims.claimedByUserId,
	createdByUserId: partnershipRewardClaims.createdByUserId,
	rewardTitle: partnershipRewardClaims.rewardTitle,
	rewardDescription: partnershipRewardClaims.rewardDescription,
	rewardCost: partnershipRewardClaims.rewardCost,
	createdAt: partnershipRewardClaims.createdAt
} as const;

type SelfRewardRow = {
	id: string;
	title: string;
	description: string | null;
	cost: number;
	active: boolean;
	createdAt: Date;
	updatedAt: Date;
};

type SelfRewardHistoryRow = {
	id: string;
	rewardTitle: string;
	rewardDescription: string | null;
	rewardCost: number;
	createdAt: Date;
};

type PartnershipRewardRow = {
	id: string;
	partnershipId: string;
	createdByUserId: string;
	title: string;
	description: string | null;
	cost: number;
	active: boolean;
	createdAt: Date;
	updatedAt: Date;
};

type RewardMembership = {
	partnership: NonNullable<Awaited<ReturnType<typeof getPartnershipForUser>>>;
	viewerId: string;
	canManage: boolean;
	canClaim: boolean;
	counterpartUserId: string;
};

export type PartnershipRewardsPageView = {
	partner: { id: string; name: string; canManageRewards: boolean; canClaimRewards: boolean };
	counterpartUserId: string | null;
	viewerCredits: number;
	counterpartCredits: number | null;
	rewards: PartnershipRewardView[];
	claims: PartnershipRewardClaimView[];
};

type RewardResult<TReason extends string> = { ok: true } | { ok: false; reason: TReason };
type CreateRewardResult<TReason extends string> =
	{ ok: true; id: string } | { ok: false; reason: TReason };

function canClaimFromPartnershipView(partnership: RewardMembership['partnership']): boolean {
	// The claimant side is the non-controller when control is one-sided, and
	// both sides when control is shared. `canEdit` already answers "am I the
	// current controller?" in this viewer's terms.
	return partnership.control === 'both' || !partnership.canEdit;
}

async function readSelfCredits(db: Db, userId: string): Promise<number> {
	const rows = await db
		.select({ credits: selfRewardCredits.credits })
		.from(selfRewardCredits)
		.where(eq(selfRewardCredits.ownerId, userId))
		.limit(1);
	return rows[0]?.credits ?? 0;
}

async function readPartnershipCredits(
	db: Db,
	partnershipId: string,
	userId: string
): Promise<number> {
	const rows = await db
		.select({ credits: partnershipRewardCredits.credits })
		.from(partnershipRewardCredits)
		.where(
			and(
				eq(partnershipRewardCredits.partnershipId, partnershipId),
				eq(partnershipRewardCredits.userId, userId)
			)
		)
		.limit(1);
	return rows[0]?.credits ?? 0;
}

function toSelfRewardView(row: SelfRewardRow, credits: number): SelfRewardView {
	return {
		id: row.id,
		title: row.title,
		description: row.description,
		cost: row.cost,
		active: row.active,
		canClaim: row.active && credits >= row.cost,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt
	};
}

function toHistoryView(row: SelfRewardHistoryRow): RewardHistoryView {
	return {
		id: row.id,
		rewardTitle: row.rewardTitle,
		rewardDescription: row.rewardDescription,
		rewardCost: row.rewardCost,
		createdAt: row.createdAt
	};
}

function toPartnershipRewardView(
	row: PartnershipRewardRow,
	viewerId: string,
	viewerCredits: number,
	viewerCanClaim: boolean
): PartnershipRewardView {
	const createdByMe = row.createdByUserId === viewerId;
	return {
		id: row.id,
		title: row.title,
		description: row.description,
		cost: row.cost,
		active: row.active,
		createdByMe,
		canClaim: viewerCanClaim && row.active && !createdByMe && viewerCredits >= row.cost,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt
	};
}

export async function requireRewardMembership(
	db: Db,
	partnershipId: string,
	userId: string
): Promise<RewardMembership | null> {
	const partnership = await getPartnershipForUser(db, partnershipId, userId);
	if (!partnership || partnership.status !== 'accepted' || !partnership.counterpart?.userId)
		return null;
	return {
		partnership,
		viewerId: userId,
		canManage: partnership.canEdit,
		canClaim: canClaimFromPartnershipView(partnership),
		counterpartUserId: partnership.counterpart.userId
	};
}

export async function getSelfRewardsSection(
	db: Db,
	userId: string
): Promise<SelfRewardsSectionView> {
	const [credits, rewards, claims] = await Promise.all([
		readSelfCredits(db, userId),
		db
			.select(selfRewardColumns)
			.from(selfRewards)
			.where(eq(selfRewards.ownerId, userId))
			.orderBy(desc(selfRewards.active), desc(selfRewards.createdAt), asc(selfRewards.id)),
		db
			.select(rewardHistoryColumns)
			.from(selfRewardClaims)
			.where(eq(selfRewardClaims.ownerId, userId))
			.orderBy(desc(selfRewardClaims.createdAt), desc(selfRewardClaims.id))
	]);

	return {
		credits,
		rewards: rewards.map((row) => toSelfRewardView(row, credits)),
		claims: claims.map(toHistoryView)
	};
}

export async function getSelfRewardForUser(
	db: Db,
	userId: string,
	rewardId: string
): Promise<SelfRewardView | null> {
	const rows = await db
		.select(selfRewardColumns)
		.from(selfRewards)
		.where(and(eq(selfRewards.id, rewardId), eq(selfRewards.ownerId, userId)))
		.limit(1);
	const row = rows[0];
	if (!row) return null;
	return toSelfRewardView(row, await readSelfCredits(db, userId));
}

export async function createSelfReward(
	db: Db,
	userId: string,
	input: RewardInput
): Promise<string> {
	const [row] = await db
		.insert(selfRewards)
		.values({
			ownerId: userId,
			title: input.title,
			description: input.description,
			cost: input.cost,
			active: input.active
		})
		.returning({ id: selfRewards.id });
	return row.id;
}

export async function updateSelfReward(
	db: Db,
	userId: string,
	rewardId: string,
	input: RewardInput
): Promise<boolean> {
	const rows = await db
		.update(selfRewards)
		.set({
			title: input.title,
			description: input.description,
			cost: input.cost,
			active: input.active
		})
		.where(and(eq(selfRewards.id, rewardId), eq(selfRewards.ownerId, userId)))
		.returning({ id: selfRewards.id });
	return rows.length > 0;
}

export async function setSelfRewardCredits(db: Db, userId: string, credits: number): Promise<void> {
	await db
		.insert(selfRewardCredits)
		.values({ ownerId: userId, credits })
		.onConflictDoUpdate({
			target: selfRewardCredits.ownerId,
			set: { credits, updatedAt: new Date() }
		});
}

export async function claimSelfReward(
	db: Db,
	userId: string,
	rewardId: string,
	now: Date = new Date()
): Promise<RewardResult<'not-found' | 'inactive' | 'insufficient-credits'>> {
	const rows = await db
		.select(selfRewardColumns)
		.from(selfRewards)
		.where(and(eq(selfRewards.id, rewardId), eq(selfRewards.ownerId, userId)))
		.limit(1);
	const reward = rows[0];
	if (!reward) return { ok: false, reason: 'not-found' };
	if (!reward.active) return { ok: false, reason: 'inactive' };

	const credits = await readSelfCredits(db, userId);
	if (credits < reward.cost) return { ok: false, reason: 'insufficient-credits' };

	const nextCredits = credits - reward.cost;
	await db.batch([
		db.insert(selfRewardClaims).values({
			ownerId: userId,
			rewardId: reward.id,
			rewardTitle: reward.title,
			rewardDescription: reward.description,
			rewardCost: reward.cost,
			createdAt: now,
			updatedAt: now
		}),
		db
			.insert(selfRewardCredits)
			.values({ ownerId: userId, credits: nextCredits, createdAt: now, updatedAt: now })
			.onConflictDoUpdate({
				target: selfRewardCredits.ownerId,
				set: { credits: nextCredits, updatedAt: now }
			})
	]);

	return { ok: true };
}

export async function getPartnershipRewardsPage(
	db: Db,
	partnershipId: string,
	userId: string
): Promise<PartnershipRewardsPageView | null> {
	const membership = await requireRewardMembership(db, partnershipId, userId);
	if (!membership) return null;

	const [viewerCredits, counterpartCredits, rewards, claims] = await Promise.all([
		readPartnershipCredits(db, partnershipId, userId),
		membership.canManage
			? readPartnershipCredits(db, partnershipId, membership.counterpartUserId)
			: Promise.resolve(0),
		db
			.select(partnershipRewardColumns)
			.from(partnershipRewards)
			.where(eq(partnershipRewards.partnershipId, partnershipId))
			.orderBy(
				desc(partnershipRewards.active),
				desc(partnershipRewards.createdAt),
				asc(partnershipRewards.id)
			),
		db
			.select(partnershipRewardHistoryColumns)
			.from(partnershipRewardClaims)
			.where(eq(partnershipRewardClaims.partnershipId, partnershipId))
			.orderBy(desc(partnershipRewardClaims.createdAt), desc(partnershipRewardClaims.id))
	]);

	return {
		partner: {
			id: partnershipId,
			name: membership.partnership.partnerName,
			canManageRewards: membership.canManage,
			canClaimRewards: membership.canClaim
		},
		counterpartUserId: membership.canManage ? membership.counterpartUserId : null,
		viewerCredits,
		counterpartCredits: membership.canManage ? counterpartCredits : null,
		rewards: rewards.map((row) =>
			toPartnershipRewardView(row, userId, viewerCredits, membership.canClaim)
		),
		claims: claims.map((row) => ({
			id: row.id,
			rewardTitle: row.rewardTitle,
			rewardDescription: row.rewardDescription,
			rewardCost: row.rewardCost,
			createdAt: row.createdAt,
			mine: row.claimedByUserId === userId,
			createdByMe: row.createdByUserId === userId
		}))
	};
}

export async function getPartnershipRewardForUser(
	db: Db,
	partnershipId: string,
	userId: string,
	rewardId: string
): Promise<{
	partner: { id: string; name: string; canManageRewards: boolean };
	reward: PartnershipRewardView;
} | null> {
	const membership = await requireRewardMembership(db, partnershipId, userId);
	if (!membership) return null;

	const rows = await db
		.select(partnershipRewardColumns)
		.from(partnershipRewards)
		.where(
			and(eq(partnershipRewards.id, rewardId), eq(partnershipRewards.partnershipId, partnershipId))
		)
		.limit(1);
	const row = rows[0];
	if (!row) return null;

	return {
		partner: {
			id: partnershipId,
			name: membership.partnership.partnerName,
			canManageRewards: membership.canManage
		},
		reward: toPartnershipRewardView(
			row,
			userId,
			await readPartnershipCredits(db, partnershipId, userId),
			membership.canClaim
		)
	};
}

export async function createPartnershipReward(
	db: Db,
	partnershipId: string,
	userId: string,
	input: RewardInput
): Promise<CreateRewardResult<'not-a-member' | 'forbidden'>> {
	const membership = await requireRewardMembership(db, partnershipId, userId);
	if (!membership) return { ok: false, reason: 'not-a-member' };
	if (!membership.canManage) return { ok: false, reason: 'forbidden' };

	const [row] = await db
		.insert(partnershipRewards)
		.values({
			partnershipId,
			createdByUserId: userId,
			title: input.title,
			description: input.description,
			cost: input.cost,
			active: input.active
		})
		.returning({ id: partnershipRewards.id });

	return { ok: true, id: row.id };
}

export async function updatePartnershipReward(
	db: Db,
	partnershipId: string,
	userId: string,
	rewardId: string,
	input: RewardInput
): Promise<RewardResult<'not-a-member' | 'forbidden' | 'not-found'>> {
	const membership = await requireRewardMembership(db, partnershipId, userId);
	if (!membership) return { ok: false, reason: 'not-a-member' };
	if (!membership.canManage) return { ok: false, reason: 'forbidden' };

	const rows = await db
		.update(partnershipRewards)
		.set({
			title: input.title,
			description: input.description,
			cost: input.cost,
			active: input.active
		})
		.where(
			and(eq(partnershipRewards.id, rewardId), eq(partnershipRewards.partnershipId, partnershipId))
		)
		.returning({ id: partnershipRewards.id });
	if (rows.length === 0) return { ok: false, reason: 'not-found' };
	return { ok: true };
}

export async function setPartnershipRewardCredits(
	db: Db,
	partnershipId: string,
	actorUserId: string,
	targetUserId: string,
	credits: number,
	now: Date = new Date()
): Promise<RewardResult<'not-a-member' | 'forbidden' | 'bad-target'>> {
	const membership = await requireRewardMembership(db, partnershipId, actorUserId);
	if (!membership) return { ok: false, reason: 'not-a-member' };
	if (!membership.canManage) return { ok: false, reason: 'forbidden' };
	if (targetUserId !== membership.counterpartUserId) return { ok: false, reason: 'bad-target' };

	await db
		.insert(partnershipRewardCredits)
		.values({ partnershipId, userId: targetUserId, credits, createdAt: now, updatedAt: now })
		.onConflictDoUpdate({
			target: [partnershipRewardCredits.partnershipId, partnershipRewardCredits.userId],
			set: { credits, updatedAt: now }
		});

	return { ok: true };
}

export async function claimPartnershipReward(
	db: Db,
	input: { partnershipId: string; rewardId: string; userId: string },
	now: Date = new Date()
): Promise<
	RewardResult<
		| 'not-a-member'
		| 'not-found'
		| 'not-allowed'
		| 'inactive'
		| 'own-reward'
		| 'insufficient-credits'
	>
> {
	const membership = await requireRewardMembership(db, input.partnershipId, input.userId);
	if (!membership) return { ok: false, reason: 'not-a-member' };
	if (!membership.canClaim) return { ok: false, reason: 'not-allowed' };

	const rows = await db
		.select(partnershipRewardColumns)
		.from(partnershipRewards)
		.where(
			and(
				eq(partnershipRewards.id, input.rewardId),
				eq(partnershipRewards.partnershipId, input.partnershipId)
			)
		)
		.limit(1);
	const reward = rows[0];
	if (!reward) return { ok: false, reason: 'not-found' };
	if (!reward.active) return { ok: false, reason: 'inactive' };
	if (reward.createdByUserId === input.userId) return { ok: false, reason: 'own-reward' };

	const credits = await readPartnershipCredits(db, input.partnershipId, input.userId);
	if (credits < reward.cost) return { ok: false, reason: 'insufficient-credits' };

	const nextCredits = credits - reward.cost;
	await db.batch([
		db.insert(partnershipRewardClaims).values({
			partnershipId: input.partnershipId,
			rewardId: reward.id,
			claimedByUserId: input.userId,
			createdByUserId: reward.createdByUserId,
			rewardTitle: reward.title,
			rewardDescription: reward.description,
			rewardCost: reward.cost,
			createdAt: now,
			updatedAt: now
		}),
		db
			.insert(partnershipRewardCredits)
			.values({
				partnershipId: input.partnershipId,
				userId: input.userId,
				credits: nextCredits,
				createdAt: now,
				updatedAt: now
			})
			.onConflictDoUpdate({
				target: [partnershipRewardCredits.partnershipId, partnershipRewardCredits.userId],
				set: { credits: nextCredits, updatedAt: now }
			})
	]);

	return { ok: true };
}

export async function listHomePartnerRewardSections(
	db: Db,
	userId: string,
	partners: PartnerView[]
): Promise<HomePartnerRewardsSectionView[]> {
	if (partners.length === 0) return [];

	const partnershipIds = partners.map((partner) => partner.id);
	const [partnershipRows, creditRows, rewardRows] = await Promise.all([
		db
			.select({
				id: partnerships.id,
				status: partnerships.status,
				control: partnerships.control,
				inviterId: partnerships.inviterId,
				inviteeId: partnerships.inviteeId,
				inviterName: partnerships.inviterName,
				inviteeName: partnerships.inviteeName,
				inviterRole: partnerships.inviterRole,
				inviteeRole: partnerships.inviteeRole
			})
			.from(partnerships)
			.where(inArray(partnerships.id, partnershipIds)),
		db
			.select({
				partnershipId: partnershipRewardCredits.partnershipId,
				credits: partnershipRewardCredits.credits
			})
			.from(partnershipRewardCredits)
			.where(
				and(
					inArray(partnershipRewardCredits.partnershipId, partnershipIds),
					eq(partnershipRewardCredits.userId, userId)
				)
			),
		db
			.select(partnershipRewardColumns)
			.from(partnershipRewards)
			.where(
				and(
					inArray(partnershipRewards.partnershipId, partnershipIds),
					eq(partnershipRewards.active, true)
				)
			)
			.orderBy(desc(partnershipRewards.createdAt), asc(partnershipRewards.id))
	]);

	const claimablePartnerships = new Map(
		partnershipRows.map((row) => [row.id, canClaimFromPartnership(row, userId)])
	);
	const creditsByPartnership = new Map(creditRows.map((row) => [row.partnershipId, row.credits]));
	const rewardsByPartnership = new Map<string, PartnershipRewardView[]>();

	for (const row of rewardRows) {
		if (!claimablePartnerships.get(row.partnershipId)) continue;
		if (row.createdByUserId === userId) continue;
		const credits = creditsByPartnership.get(row.partnershipId) ?? 0;
		const list = rewardsByPartnership.get(row.partnershipId) ?? [];
		list.push(toPartnershipRewardView(row, userId, credits, true));
		rewardsByPartnership.set(row.partnershipId, list);
	}

	return partners.flatMap((partner) => {
		if (!claimablePartnerships.get(partner.id)) return [];
		const rewards = rewardsByPartnership.get(partner.id) ?? [];
		return [
			{
				partnershipId: partner.id,
				name: partner.name,
				image: partner.image,
				credits: creditsByPartnership.get(partner.id) ?? 0,
				rewards
			}
		];
	});
}
