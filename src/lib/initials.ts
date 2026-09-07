/**
 * First letters of the first two words of a name, for avatar fallbacks.
 *
 * Shared rather than local to AppNav so the nav's small avatar and the partner
 * page's large one never disagree about what a partner without a picture looks
 * like.
 */
export function initialsFor(name: string): string {
	return name
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((word) => word[0]?.toUpperCase() ?? '')
		.join('');
}
