import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, request }) => {
	// Loaded server-side rather than through the client plugin:
	// /passkey/list-user-passkeys is a GET endpoint, but the client plugin's
	// pathMethods only declares the two legacy POST paths, so its dynamic path
	// proxy would issue a POST. SSR also avoids a loading state.
	const passkeys = await locals.auth.api.listPasskeys({ headers: request.headers });
	return { passkeys };
};
