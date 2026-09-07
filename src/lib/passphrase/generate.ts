/**
 * Generating a passphrase for someone who does not have a password yet.
 *
 * There is no maintained library for this. `eff-diceware-passphrase` is
 * Node-only and last published in 2019; the good browser generators are all
 * websites, not packages. `@scure/bip39` is audited but its 2048-word list is
 * seed-phrase-shaped and its API only emits 12/15/18/21/24-word mnemonics,
 * which is far too long to type at every login.
 *
 * So this is a wordlist plus a selection function. Note what is and is not
 * being written by hand here: the randomness comes from
 * `crypto.getRandomValues`, which is the platform's CSPRNG. The only thing this
 * file has to get right is drawing a uniform index from it, and the one real
 * pitfall there — modulo bias — is handled by rejection sampling below and
 * pinned by a test.
 */

import { EFF_LONG_WORDLIST } from './eff-long';

/**
 * The words this generator will actually pick from.
 *
 * The four hyphenated entries in the EFF list (`t-shirt`, `yo-yo`,
 * `drop-down`, `felt-tip`) are excluded, because phrases are joined with a
 * hyphen and "t-shirt" would then be indistinguishable from two separate
 * words — which makes "write down these five words" a confusing instruction.
 *
 * Filtered here rather than in `eff-long.ts` on purpose: that file is a
 * verbatim reproduction of someone else's list, and a phrase from it should
 * stay checkable against any other EFF-wordlist tool.
 */
export const PASSPHRASE_POOL: readonly string[] = EFF_LONG_WORDLIST.filter((word) =>
	/^[a-z]+$/.test(word)
);

/** Bits of entropy per word, from the pool actually drawn from. */
export const BITS_PER_WORD = Math.log2(PASSPHRASE_POOL.length);

/**
 * Words in a generated phrase.
 *
 * Five words is ~64.6 bits. That is the number this feature's threat model
 * turns on: the wrap is attackable offline, so no amount of server-side work
 * factor helps, and only the entropy of what the user actually types does.
 * Four words (~51.7 bits) is the figure Palant suggests as a floor for this
 * exact scenario; five leaves headroom without becoming unmemorable.
 */
export const PASSPHRASE_WORDS = 5;

/** What the words are joined with. See PASSPHRASE_POOL for why not a space. */
export const PASSPHRASE_SEPARATOR = '-';

/**
 * A uniformly random index into a pool of `size`, with no modulo bias.
 *
 * `getRandomValues % size` is the obvious version and it is subtly wrong: 65536
 * is not a multiple of 7772, so the low indices would come up slightly more
 * often. Instead, draw 16 bits and reject anything at or above the largest
 * multiple of `size` that fits, which makes the surviving values exactly
 * uniform. About 5% of draws are rejected for this pool.
 */
function uniformIndex(size: number): number {
	if (size <= 0 || size > 0x10000) {
		throw new Error(`Pool size ${size} is out of range for 16-bit sampling`);
	}
	const limit = Math.floor(0x10000 / size) * size;
	const buffer = new Uint16Array(1);
	for (;;) {
		crypto.getRandomValues(buffer);
		if (buffer[0] < limit) return buffer[0] % size;
	}
}

export type GeneratedPassphrase = {
	/** What the user types as their password. */
	phrase: string;
	/** The same, split, for rendering one word per chip so it can be read off. */
	words: string[];
	/** Rounded down, so the number shown is never generous. */
	entropyBits: number;
};

/**
 * A fresh passphrase.
 *
 * Words are drawn independently *with* replacement — a repeat is possible and
 * that is correct. Rejecting duplicates would reduce the entropy while looking
 * like it increased it, which is the classic way to make a generator worse by
 * trying to make it tidier.
 */
export function generatePassphrase(words: number = PASSPHRASE_WORDS): GeneratedPassphrase {
	if (!Number.isInteger(words) || words < 1) {
		throw new Error('A passphrase needs at least one word');
	}
	const picked: string[] = [];
	for (let i = 0; i < words; i++) {
		picked.push(PASSPHRASE_POOL[uniformIndex(PASSPHRASE_POOL.length)]);
	}
	return {
		phrase: picked.join(PASSPHRASE_SEPARATOR),
		words: picked,
		entropyBits: Math.floor(words * BITS_PER_WORD)
	};
}
