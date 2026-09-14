import { error } from '@sveltejs/kit';
import { fail, message, superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { controlFromAnswer } from '$lib/partnership';
import { inviteUrl } from '$lib/invite-url';
import { partnerInviteFormSchema } from '$lib/schemas/partnerForm';
import { createInvite } from '$lib/server/partnerships';
import type { Actions, PageServerLoad } from './$types';

/** The payload `message()` carries back so the page can open the share sheet. */
export type InviteCreated = { partnershipId: string; url: string };

export const load: PageServerLoad = async ({ locals }) => {
	return {
		// 'mix' rather than the enum's first member: defaulting the permission to
		// "me" would quietly hand control to whoever happened to click Add first.
		partnerInviteForm: await superValidate(
			{
				partnerName: '',
				// Pre-filled from the account so "what do they call you?" starts from
				// the name the rest of the app already shows for this user.
				yourName: locals.user?.name ?? '',
				partnerRole: null,
				yourRole: null,
				control: 'mix' as const
			},
			zod4(partnerInviteFormSchema),
			{ errors: false }
		)
	};
};

export const actions: Actions = {
	// Form actions run BEFORE layout loads, so the (auth-required) group guard
	// has not run yet — the session check here is not redundant.
	default: async ({ locals, request, url }) => {
		if (!locals.user) error(401, 'Not signed in');

		const partnerInviteForm = await superValidate(request, zod4(partnerInviteFormSchema));
		if (!partnerInviteForm.valid) {
			return fail(400, { partnerInviteForm });
		}

		const { partnerName, yourName, partnerRole, yourRole, control } = partnerInviteForm.data;
		const invite = await createInvite(locals.db, {
			inviterId: locals.user.id,
			inviteeName: partnerName,
			inviterName: yourName,
			inviteeRole: partnerRole,
			inviterRole: yourRole,
			// The person adding the partner is always the inviter, so "me" is
			// 'inviter' here.
			control: controlFromAnswer(control, 'inviter')
		});

		// Deliberately NOT a redirect. `navigator.share()` needs transient user
		// activation, and a 303 plus a fresh page load loses it — returning the
		// link to the submitting page keeps the share attempt inside the click
		// that caused it. The page navigates itself afterwards.
		return message(partnerInviteForm, {
			partnershipId: invite.id,
			url: inviteUrl(url.origin, invite.inviteToken)
		} satisfies InviteCreated);
	}
};
