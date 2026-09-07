import { describe, expect, it } from 'vitest';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, scorePassword } from './password-strength';

describe('scorePassword', () => {
	it('says nothing at all about an empty field', () => {
		expect(scorePassword('')).toEqual({ score: 0, hint: null, acceptable: false });
	});

	it('rejects anything under the minimum, and names the minimum', () => {
		for (const password of ['a', 'short', 'elevenchar']) {
			const result = scorePassword(password);
			expect(result.acceptable).toBe(false);
			expect(result.hint).toContain(String(MIN_PASSWORD_LENGTH));
		}
	});

	// The floor the signup form enforces. Raised from Better Auth's 8 because
	// this password now also protects the message history, offline.
	it('accepts exactly the minimum length', () => {
		expect(MIN_PASSWORD_LENGTH).toBe(12);
		expect(scorePassword('abzq7mwrktdp').acceptable).toBe(true);
	});

	it('rejects a password too long for the KDF to bother with', () => {
		expect(scorePassword('a'.repeat(MAX_PASSWORD_LENGTH + 1)).acceptable).toBe(false);
	});

	// Length beats punctuation, and the hint has to say so — a scorer that
	// rewarded symbols over length would give exactly the wrong advice for an
	// offline attack on the stored wrap.
	it('scores a long passphrase above a short mangled word', () => {
		const passphrase = scorePassword('vocalist-hazy-radar-plunge-cobweb');
		const mangled = scorePassword('P@ssw0rd!123');
		expect(passphrase.score).toBeGreaterThan(mangled.score);
		expect(passphrase.hint).toBeNull();
	});

	it('flags keyboard and alphabet runs', () => {
		expect(scorePassword('abcdefghijklmno').hint).toMatch(/runs/);
		expect(scorePassword('qwertyuiop12345').hint).toMatch(/runs/);
		expect(scorePassword('xk1234567mqpwz').hint).toMatch(/runs/);
	});

	it('flags repetition rather than counting it as length', () => {
		expect(scorePassword('aaaaaaaaaaaaaaaa').score).toBe(1);
		expect(scorePassword('abababababababab').hint).toMatch(/repetition/);
	});

	it('gives its top score only to something genuinely long', () => {
		expect(scorePassword('vocalist-hazy-radar-plunge-cobweb').score).toBe(4);
		expect(scorePassword('four random words yes').score).toBe(4);
		expect(scorePassword('mxkq7wtrzp9v').score).toBeLessThan(4);
	});

	it('never returns a score outside 0-4', () => {
		const samples = ['', 'a', 'abcdefghijkl', 'x'.repeat(300), 'vocalist-hazy-radar-plunge'];
		for (const sample of samples) {
			const { score } = scorePassword(sample);
			expect(score).toBeGreaterThanOrEqual(0);
			expect(score).toBeLessThanOrEqual(4);
		}
	});

	it('stops nagging once the password is good', () => {
		expect(scorePassword('vocalist-hazy-radar-plunge-cobweb').hint).toBeNull();
	});
});
