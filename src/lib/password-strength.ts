/**
 * A rough password strength signal for the signup and change-password screens.
 *
 * This is a *courtesy*, not a control, and the distinction matters enough to
 * state at the top of the file: the server never receives the password, only a
 * fixed-length value derived from it, so it cannot check length or anything
 * else about it. Strength is structurally client-side now. See
 * docs/encryption.md, and note that this is not the thing AGENTS.md invariant 14
 * forbids — that is about a *permission* being enforced by a disabled input.
 *
 * Deliberately not zxcvbn: it is ~400 KB of dictionaries for a nicer number on
 * a screen, on the two pages a first-time visitor loads.
 */

/** The floor the signup form enforces. Raised from 8 because this password now
 *  also protects the message history, which an attacker can attack offline. */
export const MIN_PASSWORD_LENGTH = 12;

/** Better Auth's own ceiling, minus nothing — just don't let the KDF eat a novel. */
export const MAX_PASSWORD_LENGTH = 256;

export type PasswordStrength = {
	/** 0 (unusable) to 4 (good). Drives the meter's width and colour. */
	score: 0 | 1 | 2 | 3 | 4;
	/** One short line of advice, or null once the password is good enough. */
	hint: string | null;
	/** Whether the form should let this through at all. */
	acceptable: boolean;
};

const SEQUENCES = ['abcdefghijklmnopqrstuvwxyz', '01234567890', 'qwertyuiop', 'asdfghjkl'];

/** True when `value` contains a run of 4+ characters straight out of a sequence. */
function hasRun(value: string): boolean {
	const lower = value.toLowerCase();
	for (const sequence of SEQUENCES) {
		for (let i = 0; i + 4 <= sequence.length; i++) {
			if (lower.includes(sequence.slice(i, i + 4))) return true;
		}
	}
	return false;
}

/**
 * Scores a password on length first and variety second.
 *
 * Length first because that is what an offline attack on the stored wrap
 * actually costs: four random words beat `P@ssw0rd!` by a wide margin, and a
 * scorer that rewarded punctuation over length would tell the user the
 * opposite.
 */
export function scorePassword(password: string): PasswordStrength {
	const length = password.length;

	if (length === 0) {
		return { score: 0, hint: null, acceptable: false };
	}
	if (length < MIN_PASSWORD_LENGTH) {
		return {
			score: length < 8 ? 0 : 1,
			hint: `Use at least ${MIN_PASSWORD_LENGTH} characters`,
			acceptable: false
		};
	}
	if (length > MAX_PASSWORD_LENGTH) {
		return {
			score: 4,
			hint: `Keep it under ${MAX_PASSWORD_LENGTH} characters`,
			acceptable: false
		};
	}

	// Distinct characters rather than a character-class count: "aaaaaaaaaaaa" is
	// twelve characters and three classes' worth of nothing.
	const distinct = new Set(password).size;

	if (hasRun(password)) {
		return { score: 1, hint: 'Avoid runs like "abcd" or "1234"', acceptable: true };
	}
	if (distinct < 5) {
		return { score: 1, hint: 'Too much repetition — mix in more characters', acceptable: true };
	}

	const hasSpaces = /\s/.test(password);
	if (length >= 20 || (length >= 16 && hasSpaces)) {
		return { score: 4, hint: null, acceptable: true };
	}
	if (length >= 16 || distinct >= 12) {
		return { score: 3, hint: null, acceptable: true };
	}
	return {
		score: 2,
		hint: 'Longer is better than more symbols — try a few random words',
		acceptable: true
	};
}
