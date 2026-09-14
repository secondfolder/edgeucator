import { error, fail } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import { setError, superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { parseKeyWrapParams } from '$lib/encryption';
import { encryptionSetupSchema } from '$lib/schemas/encryptionForms';
import { clearPasswordCredential, hasPasswordCredential } from '$lib/server/credentials';
import { deleteWrap, getUnlockBundle, putUserKeys, replaceUserKeys } from '$lib/server/keys';
import { listPartnershipsForUser } from '$lib/server/partnerships';
import { requestHistoryRestore } from '$lib/server/messaging';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	// The group guard has already run for a layout load, but narrowing here also
	// means this page degrades rather than throwing if that ever changes.
	if (!locals.user) error(401, 'Not signed in');

	const [bundle, hasPassword] = await Promise.all([
		getUnlockBundle(locals.db, locals.user.id),
		hasPasswordCredential(locals.db, locals.user.id)
	]);

	return {
		hasPassword,
		// `blob` is deliberately included: the browser needs it to open the
		// identity, and it is useless without a key the server does not have.
		bundle,
		setupForm: await superValidate(zod4(encryptionSetupSchema))
	};
};

export const actions: Actions = {
	/**
	 * Creates the message identity, and settles the password at the same time.
	 *
	 * Covers three situations that need the same writes: a passkey-first account
	 * choosing a password for the first time, an account whose signup stored a
	 * credential but not a key row, and a forgotten-password reset. Which one it
	 * is decided by whether a password credential already exists.
	 */
	setup: async ({ locals, request }) => {
		// Actions run BEFORE layout loads, so the group guard does not gate this.
		if (!locals.user) error(401, 'Not signed in');
		const form = await superValidate(request, zod4(encryptionSetupSchema));
		if (!form.valid) return fail(400, { form });

		const params = parseKeyWrapParams(form.data.wrapParams);
		if (!params) return setError(form, '', 'Could not set up encryption keys');

		const userId = locals.user.id;
		const hadPassword = await hasPasswordCredential(locals.db, userId);

		try {
			if (hadPassword) {
				// Prove the submitted secret really is this account's password before
				// sealing anything to it. Otherwise a typo here would produce a wrap
				// that the user's actual password can never open — a key that looks
				// fine and is permanently useless.
				//
				// A no-op change is the only way to ask Better Auth "is this the
				// current password?"; there is no verify endpoint.
				await locals.auth.api.changePassword({
					body: {
						currentPassword: form.data.authSecret,
						newPassword: form.data.authSecret,
						revokeOtherSessions: false
					},
					headers: request.headers
				});
			} else {
				// No credential yet, so this is the first password. `setPassword` is
				// server-only, which is why it lives in an action.
				await locals.auth.api.setPassword({
					body: { newPassword: form.data.authSecret },
					headers: request.headers
				});
			}
		} catch (caught) {
			if (caught instanceof APIError) {
				if (caught.body?.code === 'INVALID_PASSWORD') {
					return setError(form, 'authSecret', 'That is not your current password');
				}
				return setError(form, '', caught.body?.message ?? 'Could not set your password');
			}
			console.error(caught);
			return setError(form, '', 'Could not set your password');
		}

		const existing = await getUnlockBundle(locals.db, userId);
		const wrap = { type: params.type, params, blob: form.data.wrapBlob } as const;

		if (existing.recipient) {
			// Replacing an identity abandons everything encrypted to the old one, so
			// each partner is asked to re-encrypt the shared history to the new key.
			await replaceUserKeys(locals.db, userId, { recipient: form.data.recipient, wrap });
			for (const partnership of await listPartnershipsForUser(locals.db, userId)) {
				if (partnership.status !== 'accepted') continue;
				await requestHistoryRestore(locals.db, {
					partnershipId: partnership.id,
					requesterId: userId,
					recipient: form.data.recipient
				});
			}
		} else {
			await putUserKeys(locals.db, userId, { recipient: form.data.recipient, wrap });
		}

		return { form };
	},

	/** Starts a forgotten-password reset by removing the unusable credential. */
	forgetPassword: async ({ locals, request }) => {
		if (!locals.user) error(401, 'Not signed in');
		// Only reachable for someone already signed in — today that means a
		// passkey. It does not let anyone in; it lets someone already in choose a
		// new password. See the comment on clearPasswordCredential.
		await clearPasswordCredential(locals.db, locals.user.id);
		void request;
		return { forgotten: true };
	},

	/** Removes one unlock method — a revoked passkey, say. */
	revokeWrap: async ({ locals, request }) => {
		if (!locals.user) error(401, 'Not signed in');
		const data = await request.formData();
		const wrapId = String(data.get('wrapId') ?? '');

		const bundle = await getUnlockBundle(locals.db, locals.user.id);
		// Refusing to remove the last one is the whole point: a recipient with no
		// wraps is an identity nobody can ever open again, and the tempting
		// recovery from it — generate a fresh key — silently orphans every message
		// the user has ever received.
		if (bundle.wraps.length <= 1) {
			return fail(400, { revokeError: 'That is the only way you can unlock your messages' });
		}

		const removed = await deleteWrap(locals.db, wrapId, locals.user.id);
		if (!removed) return fail(404, { revokeError: 'That unlock method is already gone' });
		return { revoked: true };
	}
};
