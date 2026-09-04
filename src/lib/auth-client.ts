import { passkeyClient } from '@better-auth/passkey/client';
import { createAuthClient } from 'better-auth/svelte';

/**
 * Browser-side Better Auth client, used only for the passkey ceremonies —
 * email/password sign-in and sign-up go through server form actions.
 *
 * No `baseURL`: the client defaults to a relative `/api/auth`, which is correct
 * on localhost, behind the dev tunnel and in production alike.
 */
export const authClient = createAuthClient({
	plugins: [passkeyClient()]
});
