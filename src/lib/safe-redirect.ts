/**
 * Validates a `?redirectTo=` value before it is used in a redirect.
 *
 * Needed because the invite flow sends a signed-out visitor to /login and has
 * to bring them back to the invite afterwards. Anything that could leave the
 * origin is rejected outright rather than sanitised: `//evil.example` and
 * `/\evil.example` are both read as protocol-relative URLs by browsers, and an
 * absolute URL is an open redirect by definition.
 */
export function safeRedirect(value: string | null | undefined): string | null {
	if (!value) return null;
	if (!value.startsWith('/')) return null;
	// Second character decides: '/' or '\' makes it protocol-relative.
	if (value.length > 1 && (value[1] === '/' || value[1] === '\\')) return null;
	return value;
}

/** `next` if it is safe, otherwise the signed-in landing page. */
export function redirectTargetOrHome(value: string | null | undefined): string {
	return safeRedirect(value) ?? '/home';
}
