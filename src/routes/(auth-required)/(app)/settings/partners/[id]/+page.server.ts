import { error, fail as kitFail, redirect } from '@sveltejs/kit';
import { fail, superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { answerFromControl, controlFromAnswer, isInviteUsable } from '$lib/partnership';
import { inviteUrl } from '$lib/invite-url';
import { partnerEditFormSchema } from '$lib/schemas/partnerForm';
import {
	deletePartnership,
	getPartnershipForUser,
	rotateInviteToken,
	updatePartnership
} from '$lib/server/partnerships';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	if (!locals.user) error(401, 'Not signed in');

	const partnership = await getPartnershipForUser(locals.db, params.id, locals.user.id);
	// 404 rather than 403 for a partnership that exists but is someone else's:
	// distinguishing the two would confirm the id is real.
	if (!partnership) error(404, 'Partner not found');

	const usable = isInviteUsable(partnership, new Date());

	return {
		partnership: {
			id: partnership.id,
			status: partnership.status,
			role: partnership.role,
			partnerName: partnership.partnerName,
			yourName: partnership.yourName,
			partnerRole: partnership.partnerRole,
			yourRole: partnership.yourRole,
			canEdit: partnership.canEdit,
			counterpartImage: partnership.counterpart?.image ?? null,
			inviteExpiresAt: partnership.inviteExpiresAt
		},
		// Only ever sent to the inviter, and only while the link is live: the
		// token is the whole authorisation to join, so it must not travel in the
		// page data of anyone who cannot already use it.
		inviteUrl:
			usable && partnership.role === 'inviter' && partnership.inviteToken
				? inviteUrl(url.origin, partnership.inviteToken)
				: null,
		inviteExpired: partnership.status === 'pending' && !usable,
		partnerEditForm: await superValidate(
			{
				partnerName: partnership.partnerName,
				yourName: partnership.yourName,
				partnerRole: partnership.partnerRole,
				yourRole: partnership.yourRole,
				control: answerFromControl(partnership.control, partnership.role)
			},
			zod4(partnerEditFormSchema),
			{ errors: false }
		)
	};
};

export const actions: Actions = {
	// The (auth-required) guard is a layout load, which does not run before an
	// action — every action here checks the session itself.
	update: async ({ locals, params, request }) => {
		if (!locals.user) error(401, 'Not signed in');

		const partnerEditForm = await superValidate(request, zod4(partnerEditFormSchema));
		if (!partnerEditForm.valid) return fail(400, { partnerEditForm });

		const current = await getPartnershipForUser(locals.db, params.id, locals.user.id);
		if (!current) error(404, 'Partner not found');

		const { partnerName, yourName, partnerRole, yourRole, control } = partnerEditForm.data;
		// The submitted names are in the *viewer's* terms; storage is in the
		// inviter/invitee terms. Which way round they go flips with the role.
		const viewerIsInviter = current.role === 'inviter';
		const ok = await updatePartnership(locals.db, params.id, locals.user.id, {
			inviterName: viewerIsInviter ? yourName : partnerName,
			inviteeName: viewerIsInviter ? partnerName : yourName,
			inviterRole: viewerIsInviter ? yourRole : partnerRole,
			inviteeRole: viewerIsInviter ? partnerRole : yourRole,
			control: controlFromAnswer(control, current.role)
		});

		// Re-checked against the stored row rather than trusting the page having
		// hidden the form: control can have changed since it was rendered.
		if (!ok) return kitFail(403, { partnerEditForm, denied: true });

		redirect(303, '/settings/partners');
	},

	/**
	 * Issues a replacement invite link.
	 *
	 * Returns the URL instead of redirecting so the page can put it straight
	 * into the share sheet while the click's user activation is still live.
	 */
	rotate: async ({ locals, params, url }) => {
		if (!locals.user) error(401, 'Not signed in');

		const rotated = await rotateInviteToken(locals.db, params.id, locals.user.id);
		if (!rotated) return kitFail(400, { rotateError: 'That invite can no longer be renewed.' });

		return { url: inviteUrl(url.origin, rotated.inviteToken) };
	},

	/**
	 * Leaves the link, or cancels it if it was never accepted.
	 *
	 * Not gated on `control` on purpose — a user who handed control to their
	 * partner must still be able to get out. See `deletePartnership`.
	 */
	disconnect: async ({ locals, params }) => {
		if (!locals.user) error(401, 'Not signed in');

		const removed = await deletePartnership(locals.db, params.id, locals.user.id);
		if (!removed) error(404, 'Partner not found');

		redirect(303, '/settings/partners');
	}
};
