import type { Auth } from './auth';

export type UserProfileChanges = {
	name?: string;
	timezone?: string;
};

export async function updateCurrentUserProfile(
	auth: Auth,
	headers: Headers,
	changes: UserProfileChanges
) {
	return auth.api.updateUser({ body: changes, headers });
}
