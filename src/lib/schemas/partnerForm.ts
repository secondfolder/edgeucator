import { z } from 'zod';

/**
 * The questions asked when adding a partner, plus the optional roles.
 *
 * Shared by `/settings/partners/new`, the accept screen at `/invite/[token]`
 * and the edit screen, so the wording of a validation error is identical
 * wherever the same field is collected.
 */

/** "Who's in control?" is always asked from the answerer's own side. */
export const controlAnswerSchema = z.enum(['me', 'them', 'mix']);

const nameSchema = z
	.string()
	.trim()
	.min(1, 'Please enter a name')
	// Nav tabs and avatars render this; unbounded input would break the layout
	// long before it broke the database.
	.max(60, 'Please keep this to 60 characters or fewer');

const roleSchema = z
	.string()
	.trim()
	.max(40, 'Please keep this to 40 characters or fewer')
	// An empty box means "no role", not an empty string — normalising here
	// keeps the column NULL rather than '' for the same intent.
	.transform((value) => (value === '' ? null : value))
	.nullable()
	.default(null);

export const partnerInviteFormSchema = z.object({
	/** "What's their name/title?" */
	partnerName: nameSchema,
	/** "What do they call you?" */
	yourName: nameSchema,
	/** Their half of the "Roles" section. */
	partnerRole: roleSchema,
	/** Your half of the "Roles" section. */
	yourRole: roleSchema,
	control: controlAnswerSchema
});

export type PartnerInviteFormSchema = typeof partnerInviteFormSchema;

/**
 * The accept screen.
 *
 * Same fields, because when the accepter holds control (or shares it) they may
 * rewrite every one of them. When they do not, the action ignores the submitted
 * values entirely rather than trusting a disabled input — a disabled field is a
 * rendering decision, not a security boundary.
 */
export const partnerAcceptFormSchema = partnerInviteFormSchema;

export type PartnerAcceptFormSchema = typeof partnerAcceptFormSchema;

/** The edit screen. Identical shape; the server re-checks who may submit it. */
export const partnerEditFormSchema = partnerInviteFormSchema;

export type PartnerEditFormSchema = typeof partnerEditFormSchema;
