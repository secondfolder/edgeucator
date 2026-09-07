import { z } from 'zod';
import { authSecretField, identityFields } from './keyWrap';

/**
 * Setting up message keys on an account that has none, or starting again after
 * a forgotten password.
 *
 * `authSecret` is included because both cases also settle what the account's
 * password is: a passkey-first account is choosing one for the first time, and
 * a forgotten-password reset is replacing an unknown one. An account that
 * already has a working password and merely lost its key row is the third case,
 * and it posts the same fields — the action verifies the secret matches before
 * trusting it.
 */
export const encryptionSetupSchema = z.object({
	authSecret: authSecretField,
	...identityFields
});

export type EncryptionSetupSchema = typeof encryptionSetupSchema;

/**
 * Changing the password, which has to re-seal the identity.
 *
 * Both secrets are derived in the browser: the current one proves the user
 * knows the old password, and the new wrap is built from the identity that the
 * old password just opened. If the old password were wrong the browser would
 * have failed to open the wrap and never got here — see `buildPasswordChange`.
 */
export const changePasswordSchema = z.object({
	currentAuthSecret: authSecretField,
	newAuthSecret: authSecretField,
	wrapParams: identityFields.wrapParams,
	wrapBlob: identityFields.wrapBlob
});

export type ChangePasswordSchema = typeof changePasswordSchema;
