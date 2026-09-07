/**
 * Builds the absolute URL that gets shared out-of-band.
 *
 * Absolute rather than relative because it leaves the app entirely — it is
 * pasted into a message. Built from the request's own origin so it is correct
 * on localhost, on the dev tunnel and in production without configuration.
 */
export function inviteUrl(origin: string, token: string): string {
	return new URL(`/invite/${encodeURIComponent(token)}`, origin).toString();
}
