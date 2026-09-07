import { z } from 'zod';
import { authSecretField } from './keyWrap';

export const loginFormSchema = z.object({
	email: z.email(),
	/**
	 * Not a password. The browser derives this from the password and the email,
	 * and the password itself never leaves the device — see
	 * `src/lib/crypto/kdf.ts` and docs/encryption.md.
	 *
	 * This also strengthens the existing rule that a login failure must not
	 * reveal which factor was wrong: a mistyped email now produces a *different*
	 * auth secret, so Better Auth's 401 is indistinguishable in both directions.
	 */
	authSecret: authSecretField
});

export type LoginFormSchema = typeof loginFormSchema;
