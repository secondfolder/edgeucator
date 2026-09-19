import { z } from 'zod';
import { richTextFieldSchema } from '$lib/schemas/richTextField';

const titleSchema = z
	.string()
	.trim()
	.min(1, 'Please enter a reward title')
	.max(80, 'Please keep this to 80 characters or fewer');

/** Rich text: the 500 is characters of prose, not bytes of document. */
const descriptionSchema = richTextFieldSchema(500);

const creditsSchema = z.coerce
	.number()
	.int('Please enter a whole number')
	.min(0, 'Credits cannot be negative');

const rewardIdSchema = z.string().uuid('Malformed reward id');

const userIdSchema = z.string().trim().min(1, 'Malformed user id');

export const rewardFormSchema = z.object({
	title: titleSchema,
	description: descriptionSchema,
	cost: creditsSchema,
	active: z.boolean()
});

export const rewardClaimSchema = z.object({ rewardId: rewardIdSchema });

export const partnerRewardClaimSchema = rewardClaimSchema.extend({
	partnershipId: z.string().uuid('Malformed partnership id')
});

export const rewardCreditsSchema = z.object({
	targetUserId: userIdSchema,
	credits: creditsSchema
});

export const rewardUpdateSchema = rewardFormSchema.extend({ rewardId: rewardIdSchema });

export type RewardFormSchema = typeof rewardFormSchema;
export type RewardCreditsSchema = typeof rewardCreditsSchema;
export type RewardUpdateSchema = typeof rewardUpdateSchema;
