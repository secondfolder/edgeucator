/**
 * A hand-off between the auth form and the encryption gate.
 *
 * BROWSER ONLY — see the note at the top of `kdf.ts`.
 *
 * Login and signup already derive the wrap key while they have the password in
 * hand; a moment later the app shell mounts and needs it to unlock. Without
 * somewhere to put it in between, the user would be asked for the password
 * again on the very next screen.
 *
 * A module-level variable and nothing more. It survives the trip because
 * superforms' `enhance` handles the action's 303 with `goto()` — a client-side
 * navigation, so the module is not re-evaluated. It does NOT survive a full
 * page load, which is correct: nothing here is persisted, and a cold start is
 * supposed to go through the unlock prompt.
 *
 * Read once. `take*` clears as it returns, so a stale key cannot be picked up
 * by a later navigation, and there is no window where two callers disagree
 * about whose credentials these are.
 */

type Stashed = {
	/** The email these were derived from, so a mismatch can be detected. */
	email: string;
	wrapKey: CryptoKey;
	/** Only set by signup, which generates the identity in the same submit. */
	identity?: string;
	recipient?: string;
};

let stashed: Stashed | undefined;

export function stashUnlock(value: Stashed): void {
	stashed = value;
}

/**
 * Takes what was stashed, if it belongs to this user.
 *
 * The email is checked rather than trusted: signing in as one account, then as
 * another without a full reload, would otherwise hand the second session the
 * first one's wrap key — which would fail to unwrap, but would fail confusingly.
 */
export function takeUnlock(email: string): Stashed | undefined {
	const value = stashed;
	stashed = undefined;
	if (!value) return undefined;
	return value.email === email ? value : undefined;
}

/** Drops anything held, on sign-out or an explicit lock. */
export function clearStash(): void {
	stashed = undefined;
}
