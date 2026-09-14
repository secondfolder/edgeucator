import { error, redirect } from '@sveltejs/kit';
import { fail, setError, superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import {
	answerFromControl,
	canEditPartnership,
	controlFromAnswer,
	isInviteUsable
} from '$lib/partnership';
import { partnerAcceptFormSchema } from '$lib/schemas/partnerForm';
import {
	acceptInvite,
	findPendingInviteByToken,
	partnershipExistsBetween
} from '$lib/server/partnerships';
import type { Actions, PageServerLoad } from './$types';

/**
 * The invite landing page.
 *
 * Lives under `(public)` because the whole point is that it is opened by
 * someone who may not have an account yet — the auth guard would bounce them to
 * /login and, since the guard carries no redirectTo, lose the invite entirely.
 * The accept action does its own session check instead.
 */

/** Everything the page can be, rather than a pile of independent booleans. */
export type InviteState = 'invalid' | 'sign-in-required' | 'self' | 'already-linked' | 'confirm';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const invite = await findPendingInviteByToken(locals.db, params.token);

	// A missing token and an expired one are reported the same way. There is no
	// value in telling an anonymous visitor which of the two they found.
	if (!invite || !isInviteUsable(invite, new Date())) {
		return { state: 'invalid' as const, inviterName: null };
	}

	// The name the *inviter* chose for themselves is the only thing shown before
	// sign-in. No email, no real name, nothing else off the user row.
	const inviterName = invite.inviterName;

	if (!locals.user) {
		return {
			state: 'sign-in-required' as const,
			inviterName,
			// Round-trips through /login and /signup so the visitor lands back
			// here. Validated by `safeRedirect` on the way out.
			redirectTo: url.pathname
		};
	}

	if (locals.user.id === invite.inviterId) {
		return { state: 'self' as const, inviterName };
	}

	if (await partnershipExistsBetween(locals.db, invite.inviterId, locals.user.id)) {
		return { state: 'already-linked' as const, inviterName };
	}

	// "If their permissions are set to them in control or to mix then the invite
	// should have the names in editable fields, if not they should just be
	// displayed" — the accepter is always the invitee.
	const editable = canEditPartnership({ ...invite, inviteeId: locals.user.id }, locals.user.id);

	return {
		state: 'confirm' as const,
		inviterName,
		editable,
		partnerAcceptForm: await superValidate(
			{
				// From the accepter's side: "them" is the inviter.
				partnerName: invite.inviterName,
				yourName: invite.inviteeName,
				partnerRole: invite.inviterRole,
				yourRole: invite.inviteeRole,
				control: answerFromControl(invite.control, 'invitee')
			},
			zod4(partnerAcceptFormSchema),
			{ errors: false }
		)
	};
};

export const actions: Actions = {
	default: async ({ locals, params, request }) => {
		// `(public)` means anyone can reach this, and actions run before layout
		// loads regardless — so this is the only session check there is.
		if (!locals.user) error(401, 'Sign in to accept this invite');

		const partnerAcceptForm = await superValidate(request, zod4(partnerAcceptFormSchema));
		if (!partnerAcceptForm.valid) return fail(400, { partnerAcceptForm });

		const { partnerName, yourName, partnerRole, yourRole, control } = partnerAcceptForm.data;
		const result = await acceptInvite(locals.db, {
			token: params.token,
			inviteeId: locals.user.id,
			// Storage is in inviter/invitee terms; the accepter is the invitee, so
			// what they call their partner is the *inviter's* name.
			inviterName: partnerName,
			inviteeName: yourName,
			inviterRole: partnerRole,
			inviteeRole: yourRole,
			control: controlFromAnswer(control, 'invitee')
		});

		if (!result.ok) {
			// acceptInvite decides whether the submitted names are honoured, so a
			// failure here is about the invite itself, not the fields.
			return setError(partnerAcceptForm, '', inviteFailureMessage(result.reason), {
				status: result.reason === 'not-found' ? 404 : 400
			});
		}

		redirect(303, `/partner/${result.id}`);
	}
};

function inviteFailureMessage(reason: 'not-found' | 'expired' | 'self' | 'already-linked'): string {
	switch (reason) {
		case 'expired':
			return 'This invite link has expired. Ask them to send you a new one.';
		case 'self':
			return 'This is your own invite link.';
		case 'already-linked':
			return "You're already linked with this person.";
		default:
			return 'This invite link is no longer valid. Ask them to send you a new one.';
	}
}
