import { redirect } from '@sveltejs/kit';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async ({ locals, request }) => {
		// Moved out of (auth-required): actions run before load functions, so the
		// group guard never actually gated this, and redirecting an
		// already-expired session to /login instead of logging it out was a
		// confusing edge.
		//
		// Needs the incoming cookies to know which session to revoke; the
		// clearing Set-Cookie is applied by the sveltekitCookies plugin.
		await locals.auth.api.signOut({ headers: request.headers });
		redirect(303, '/');
	}
};
