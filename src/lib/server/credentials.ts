import { and, eq, isNotNull } from 'drizzle-orm';
import type { Db } from './db';
import { account } from './db/schema';

/**
 * The two things the encryption settings screen needs to know about a user's
 * password credential, which Better Auth's API cannot answer.
 *
 * Reading and writing the `account` table directly is fine — it is
 * `schema/auth.ts` that is generated and must not be hand-edited (invariant 7),
 * not the data in it. Both functions are scoped to one user and touch only the
 * `credential` provider row.
 */

/** Better Auth's provider id for an email-and-password credential. */
const CREDENTIAL_PROVIDER = 'credential';

/** Whether this account can be signed into with a password at all. */
export async function hasPasswordCredential(db: Db, userId: string): Promise<boolean> {
	const rows = await db
		.select({ id: account.id })
		.from(account)
		.where(
			and(
				eq(account.userId, userId),
				eq(account.providerId, CREDENTIAL_PROVIDER),
				isNotNull(account.password)
			)
		)
		.limit(1);
	return rows.length > 0;
}

/**
 * Removes the stored password so a new one can be set without knowing the old.
 *
 * Needed because `auth.api.setPassword` throws `PASSWORD_ALREADY_SET` when a
 * password exists (verified in better-auth's `update-user.mjs`), and
 * `changePassword` requires the current one — which is exactly what someone in
 * this situation does not have. There is no reset-by-email flow in this app:
 * `requestPasswordReset` refuses to run without a `sendResetPassword` handler,
 * and there is no mailer.
 *
 * Reaching past Better Auth's own API like this is deliberate and narrow. What
 * makes it safe is the caller: it runs only for an already-authenticated
 * session, which today means the user got in with a passkey. It is not a
 * password reset for someone who cannot already prove who they are.
 *
 * This does NOT recover the message identity — the wrap is the only copy and
 * the old password was the only key to it. The caller replaces the identity and
 * asks the partner to re-encrypt the history. See docs/messaging.md.
 */
export async function clearPasswordCredential(db: Db, userId: string): Promise<boolean> {
	const rows = await db
		.update(account)
		.set({ password: null })
		.where(and(eq(account.userId, userId), eq(account.providerId, CREDENTIAL_PROVIDER)))
		.returning({ id: account.id });
	return rows.length > 0;
}
