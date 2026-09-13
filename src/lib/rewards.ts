import { canEditPartnership, roleOf, type PartnershipRecord } from './partnership';

/** The editable fields on a reward in either scope. */
export type RewardInput = {
	title: string;
	description: string | null;
	cost: number;
	active: boolean;
};

export type PartnershipRewardRecord = Pick<
	PartnershipRecord,
	'control' | 'inviterId' | 'inviteeId'
> & {
	status: PartnershipRecord['status'];
	partnershipId: string;
	createdByUserId: string;
	active: boolean;
	cost: number;
};

/** Shared control means both members can manage rewards, matching link edits. */
export function canManagePartnershipRewards(record: PartnershipRecord, userId: string): boolean {
	return canEditPartnership(record, userId);
}

/**
 * Whether this member is on the claiming side of the current control setting.
 *
 * Sole control splits the feature into manager and claimant roles; shared
 * control deliberately lets both members do both.
 */
export function canClaimFromPartnership(
	record: Pick<PartnershipRecord, 'status' | 'control' | 'inviterId' | 'inviteeId'>,
	userId: string
): boolean {
	const role = roleOf(record, userId);
	if (!role || record.status !== 'accepted') return false;
	return record.control === 'both' || record.control !== role;
}

/** Managers may set the counterpart's balance, never their own. */
export function canSetPartnershipCredits(
	record: PartnershipRecord,
	actorUserId: string,
	targetUserId: string
): boolean {
	if (!canManagePartnershipRewards(record, actorUserId)) return false;
	if (actorUserId === targetUserId) return false;
	const actorRole = roleOf(record, actorUserId);
	if (!actorRole || record.status !== 'accepted') return false;
	const counterpartId = actorRole === 'inviter' ? record.inviteeId : record.inviterId;
	return counterpartId === targetUserId;
}

/**
 * One reward claim check.
 *
 * Authorship is independent of control: even under shared control a user may
 * never claim their own reward, but can still claim one the other member wrote.
 */
export function canClaimPartnershipReward(
	record: PartnershipRewardRecord,
	viewerId: string,
	availableCredits: number
): boolean {
	if (!canClaimFromPartnership(record, viewerId)) return false;
	if (!record.active) return false;
	if (record.createdByUserId === viewerId) return false;
	return availableCredits >= record.cost;
}
