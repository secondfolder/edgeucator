import { error, fail } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import { setError, superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { parseKeyWrapParams } from '$lib/encryption';
import { changePasswordSchema } from '$lib/schemas/encryptionForms';
import { hasPasswordCredential } from '$lib/server/credentials';
import { addWrap, deleteOtherPasswordWraps, deleteWrap, getUnlockBundle } from '$lib/server/keys';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, request }) => {
	if (!locals.user) error(401, 'Not signed in');

	const [bundle, hasPassword, passkeys] = await Promise.all([
		getUnlockBundle(locals.db, locals.user.id),
		hasPasswordCredential(locals.db, locals.user.id),
		locals.auth.api.listPasskeys({ headers: request.headers })
	]);

	return {
		bundle,
		hasPassword,
		passkeys,
		changeForm: await superValidate(zod4(changePasswordSchema))
	};
};

export const actions: Actions = {
	/**
	 * Changes the account password, and re-seals message keys under it when the
	 * account already has encrypted-message history.
	 */
	changePassword: async ({ locals, request }) => {
		if (!locals.user) error(401, 'Not signed in');
		const form = await superValidate(request, zod4(changePasswordSchema));
		if (!form.valid) return fail(400, { form });

		const bundle = await getUnlockBundle(locals.db, locals.user.id);
		if (!bundle.recipient) {
			try {
				await locals.auth.api.changePassword({
					body: {
						currentPassword: form.data.currentAuthSecret,
						newPassword: form.data.newAuthSecret,
						revokeOtherSessions: false
					},
					headers: request.headers
				});
			} catch (caught) {
				if (caught instanceof APIError) {
					if (caught.body?.code === 'INVALID_PASSWORD') {
						return setError(form, 'currentAuthSecret', 'That password is not right');
					}
					return setError(form, '', caught.body?.message ?? 'Could not change your password');
				}

				console.error(caught);
				return setError(form, '', 'Could not change your password');
			}

			return { form };
		}

		const params = parseKeyWrapParams(form.data.wrapParams ?? '');
		if (!params || params.type !== 'password' || !form.data.wrapBlob) {
			return setError(form, '', 'Could not re-seal your keys');
		}

		const newWrapId = await addWrap(locals.db, locals.user.id, {
			type: 'password',
			params,
			blob: form.data.wrapBlob
		});

		try {
			await locals.auth.api.changePassword({
				body: {
					currentPassword: form.data.currentAuthSecret,
					newPassword: form.data.newAuthSecret,
					// Revoking a session does not revoke a key another device already
					// holds, so a half-revoked fleet of still-decrypting devices would
					// be a worse story than an honest one. See docs/encryption.md.
					revokeOtherSessions: false
				},
				headers: request.headers
			});
		} catch (caught) {
			// The new wrap is now orphaned but harmless — nothing opens it, and the
			// next successful change replaces it. Removing it is still tidier.
			await deleteWrap(locals.db, newWrapId, locals.user.id);
			if (caught instanceof APIError) {
				// Post-authentication, naming the wrong factor is helpful rather than
				// a leak: the no-leak rule is about the unauthenticated login surface.
				if (caught.body?.code === 'INVALID_PASSWORD') {
					return setError(form, 'currentAuthSecret', 'That password is not right');
				}
				return setError(form, '', caught.body?.message ?? 'Could not change your password');
			}

			console.error(caught);
			return setError(form, '', 'Could not change your password');
		}

		await deleteOtherPasswordWraps(locals.db, locals.user.id, newWrapId);
		return { form };
	}
};
