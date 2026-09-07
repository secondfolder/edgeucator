import { describe, expect, it } from 'vitest';
import { JITTER_MAX_PERCENT, TILT_MAX_DEGREES, stickerJitter, stickerStyle } from './sticker';

const ids = Array.from({ length: 2000 }, () => crypto.randomUUID());

describe('stickerJitter', () => {
	// The requirement is "stable across reloads". This is the assertion that
	// says so, rather than a comment hoping it.
	it('is deterministic for the same id', () => {
		const id = crypto.randomUUID();
		expect(stickerJitter(id)).toEqual(stickerJitter(id));
	});

	it('stays inside the bounds that keep neighbours from overlapping', () => {
		for (const id of ids) {
			const { x, y, tilt } = stickerJitter(id);
			expect(Math.abs(x)).toBeLessThanOrEqual(JITTER_MAX_PERCENT);
			expect(Math.abs(y)).toBeLessThanOrEqual(JITTER_MAX_PERCENT);
			expect(Math.abs(tilt)).toBeLessThanOrEqual(TILT_MAX_DEGREES);
		}
	});

	// A hash that only ever produced positive offsets would look obviously wrong
	// on screen and sail through a bounds check.
	it('produces both signs on every axis', () => {
		const jitters = ids.map(stickerJitter);
		for (const axis of ['x', 'y', 'tilt'] as const) {
			expect(
				jitters.some((j) => j[axis] > 0),
				`${axis} never positive`
			).toBe(true);
			expect(
				jitters.some((j) => j[axis] < 0),
				`${axis} never negative`
			).toBe(true);
		}
	});

	it('uses most of the available range', () => {
		const xs = ids.map((id) => stickerJitter(id).x);
		expect(Math.max(...xs)).toBeGreaterThanOrEqual(JITTER_MAX_PERCENT - 1);
		expect(Math.min(...xs)).toBeLessThanOrEqual(-(JITTER_MAX_PERCENT - 1));
	});

	it('scatters similar ids to different places', () => {
		const a = stickerJitter('0192b8c0-0000-7000-8000-000000000001');
		const b = stickerJitter('0192b8c0-0000-7000-8000-000000000002');
		expect(a).not.toEqual(b);
	});

	it('does not collapse a whole board onto one spot', () => {
		const distinct = new Set(
			ids.slice(0, 200).map((id) => `${stickerJitter(id).x},${stickerJitter(id).y}`)
		);
		expect(distinct.size).toBeGreaterThan(100);
	});
});

describe('stickerStyle', () => {
	// What lands in an inline style attribute must provably be numbers and
	// units, with no path from user input into it.
	it('emits only the three custom properties, as numbers with units', () => {
		for (const id of ids.slice(0, 100)) {
			expect(stickerStyle(id)).toMatch(/^--jx: -?\d+%; --jy: -?\d+%; --tilt: -?\d+deg$/);
		}
	});
});
