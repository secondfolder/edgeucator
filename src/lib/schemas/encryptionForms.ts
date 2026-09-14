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
 * Changing the password from Security.
 *
 * The auth secrets are always derived in the browser. If the account already
 * has message keys, the same submit also includes a replacement wrap so the
 * identity stays readable under the new password.
 */
export const changePasswordSchema = z.object({
	currentAuthSecret: authSecretField,
	newAuthSecret: authSecretField,
	wrapParams: identityFields.wrapParams.optional(),
	wrapBlob: identityFields.wrapBlob.optional()
});

export type ChangePasswordSchema = typeof changePasswordSchema;
