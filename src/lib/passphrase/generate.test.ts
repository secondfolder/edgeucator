import { describe, expect, it } from 'vitest';
import { EFF_LONG_WORDLIST } from './eff-long';
import {
	BITS_PER_WORD,
	PASSPHRASE_POOL,
	PASSPHRASE_SEPARATOR,
	PASSPHRASE_WORDS,
	generatePassphrase
} from './generate';

describe('EFF_LONG_WORDLIST', () => {
	// The list is a verbatim reproduction of someone else's work, and its exact
	// contents are what let a phrase from here be checked against any other
	// EFF-wordlist tool. These assertions are the guard on "do not tidy it".
	it('is the full 7776-word list, with no duplicates', () => {
		expect(EFF_LONG_WORDLIST).toHaveLength(7776);
		expect(new Set(EFF_LONG_WORDLIST).size).toBe(7776);
	});

	it('starts and ends where the published list does', () => {
		expect(EFF_LONG_WORDLIST[0]).toBe('abacus');
		expect(EFF_LONG_WORDLIST.at(-1)).toBe('zoom');
	});

	it('contains no whitespace or empty entries — the split would be off by one', () => {
		for (const word of EFF_LONG_WORDLIST) expect(word).toMatch(/^[a-z]+(-[a-z]+)*$/);
	});
});

describe('PASSPHRASE_POOL', () => {
	// Joined with a hyphen, so "t-shirt" would be indistinguishable from two
	// words and "write down these five words" becomes a confusing instruction.
	it('excludes exactly the four hyphenated words', () => {
		expect(PASSPHRASE_POOL).toHaveLength(7772);
		const dropped = EFF_LONG_WORDLIST.filter((w) => !PASSPHRASE_POOL.includes(w));
		expect(dropped).toEqual(['drop-down', 'felt-tip', 't-shirt', 'yo-yo']);
	});

	it('carries the entropy the UI claims', () => {
		expect(BITS_PER_WORD).toBeCloseTo(12.924, 3);
		expect(PASSPHRASE_WORDS * BITS_PER_WORD).toBeGreaterThan(64);
	});
});

describe('generatePassphrase', () => {
	it('returns the requested number of words from the pool', () => {
		const result = generatePassphrase();
		expect(result.words).toHaveLength(PASSPHRASE_WORDS);
		for (const word of result.words) expect(PASSPHRASE_POOL).toContain(word);
	});

	it('joins with the separator and nothing else', () => {
		const { phrase, words } = generatePassphrase();
		expect(phrase).toBe(words.join(PASSPHRASE_SEPARATOR));
		expect(phrase).toMatch(/^[a-z]+(-[a-z]+)*$/);
		// No stray whitespace: a phrase that round-trips through a form field and
		// back must be byte-identical or the master key changes.
		expect(phrase.trim()).toBe(phrase);
	});

	it('never reports more entropy than it has', () => {
		expect(generatePassphrase(5).entropyBits).toBeLessThanOrEqual(5 * BITS_PER_WORD);
		expect(generatePassphrase(5).entropyBits).toBe(64);
	});

	it('honours a custom word count', () => {
		expect(generatePassphrase(1).words).toHaveLength(1);
		expect(generatePassphrase(8).words).toHaveLength(8);
	});

	it('refuses a nonsensical word count', () => {
		expect(() => generatePassphrase(0)).toThrow(/at least one word/);
		expect(() => generatePassphrase(-1)).toThrow(/at least one word/);
		expect(() => generatePassphrase(1.5)).toThrow(/at least one word/);
	});

	it('does not repeat itself', () => {
		const phrases = new Set(Array.from({ length: 200 }, () => generatePassphrase().phrase));
		expect(phrases.size).toBe(200);
	});

	/**
	 * The one real pitfall in this file. `getRandomValues() % 7772` would favour
	 * the low indices, because 65536 is not a multiple of the pool size.
	 *
	 * Chi-squared over 20 coarse buckets, 40,000 draws, so each bucket expects
	 * 2,000. Measured against both implementations before picking the threshold:
	 * the rejection-sampled version scores 12-31, the naive modulo version scores
	 * 160-210. 50 sits between them with room on both sides — a factor of three
	 * below the biased range, and roughly a 1-in-10,000 chance of a fair run
	 * tripping it (19 degrees of freedom).
	 */
	it('draws uniformly — no modulo bias', () => {
		const buckets = new Array(20).fill(0);
		const size = PASSPHRASE_POOL.length;
		const draws = 40_000;
		for (let i = 0; i < draws; i++) {
			const index = PASSPHRASE_POOL.indexOf(generatePassphrase(1).words[0]);
			buckets[Math.floor((index / size) * buckets.length)]++;
		}
		const expected = draws / buckets.length;
		const chiSquared = buckets.reduce((sum, n) => sum + (n - expected) ** 2 / expected, 0);
		expect(chiSquared, `buckets: ${buckets.join(',')}`).toBeLessThan(50);
	});

	/**
	 * Rejecting duplicates would lower the entropy while looking like it raised
	 * it — the classic way to make a generator worse by tidying it.
	 *
	 * Asked for more words than the pool holds, so a repeat is forced by the
	 * pigeonhole principle rather than waited for. The obvious version of this
	 * test — draw a few hundred five-word phrases and look for a collision —
	 * only passes about a quarter of the time, because a repeat within five
	 * draws from 7772 words is genuinely rare.
	 */
	it('draws with replacement, so a repeat is possible', () => {
		const { words } = generatePassphrase(PASSPHRASE_POOL.length + 1);
		expect(new Set(words).size).toBeLessThan(words.length);
	});
});
