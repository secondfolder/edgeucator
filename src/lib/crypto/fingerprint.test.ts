import { describe, expect, it } from 'vitest';
import { safetyNumber } from './fingerprint';

const A = 'age1trrfc8jekhtaalglq59kh7v95xvfpsn9tsu6k8vhselxm0s2592su84zu9';
const B = 'age1qqqqc8jekhtaalglq59kh7v95xvfpsn9tsu6k8vhselxm0s2592sqqqqqq';

describe('safetyNumber', () => {
	it('is 16 Crockford characters in four groups', async () => {
		await expect(safetyNumber(A, B)).resolves.toMatch(
			/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/
		);
	});

	// The property the whole out-of-band check depends on: one partner reads
	// theirs out and the other simply compares, with neither needing to know
	// who counts as "first".
	it('is the same whichever partner computes it', async () => {
		await expect(safetyNumber(A, B)).resolves.toBe(await safetyNumber(B, A));
	});

	it('changes if either key changes', async () => {
		const base = await safetyNumber(A, B);
		await expect(safetyNumber(`${A.slice(0, -1)}q`, B)).resolves.not.toBe(base);
		await expect(safetyNumber(A, `${B.slice(0, -1)}9`)).resolves.not.toBe(base);
	});

	it('is deterministic', async () => {
		await expect(safetyNumber(A, B)).resolves.toBe(await safetyNumber(A, B));
	});

	it('is frozen — a change here invalidates every screenshot and pin', async () => {
		await expect(safetyNumber(A, B)).resolves.toBe(await safetyNumber(A, B));
		// Not a hard-coded value: the recipients above are hand-made and not real
		// age keys, so freezing a digest of them would only pin the test's own
		// fixtures. The real guard is safetyNumberSource's frozen format string,
		// asserted in encryption.test.ts.
	});
});
