/**
 * Where a thread's sticker sits on the board, and how far it is tilted.
 *
 * Pure and alias-free so it can be unit-tested without a DOM, and so the same
 * function runs during SSR and after hydration — a layout that differed between
 * the two would visibly jump on load.
 */

/**
 * FNV-1a over a string, as an unsigned 32-bit integer.
 *
 * `Math.imul` keeps the multiply in 32 bits. A plain `*` would go through a
 * double and quietly lose the low bits, which are exactly the bits that make
 * two similar UUIDs land in different places.
 */
function hash32(input: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash >>> 0;
}

/**
 * Maximum offset, as a percentage of the sticker's own size.
 *
 * Bounded, and that bound is what makes the layout safe: the sticker lives in a
 * CSS grid cell and this shifts it within that cell, so two neighbours can
 * never overlap enough to hide either one. Free absolute positioning from a
 * hash could not promise that, could not express the board's ordering, and
 * could not reflow onto a narrow phone.
 */
export const JITTER_MAX_PERCENT = 12;

/** Maximum tilt in degrees. Enough to read as "stuck on by hand", not as broken. */
export const TILT_MAX_DEGREES = 9;

export type StickerJitter = {
	/** Horizontal offset, percent of the sticker's own width. */
	x: number;
	/** Vertical offset, percent of the sticker's own height. */
	y: number;
	tilt: number;
};

/**
 * A stable pseudo-random placement for one thread's sticker.
 *
 * Derived from the thread id — not `Math.random`, and not the thread's index in
 * the list. The id is what makes the board look identical on every reload, on
 * both people's phones, and after a new thread arrives and pushes the others
 * down; an index-derived layout would reshuffle every sticker on the board
 * every time anyone sent a message.
 *
 * Three byte slices out of one 32-bit hash, each mapped to -1..1. Three
 * separate hashes would be tidier and would also be three times the work for a
 * value nobody can distinguish from this one.
 */
export function stickerJitter(id: string): StickerJitter {
	const hash = hash32(id);
	const signed = (byte: number) => (byte / 255) * 2 - 1;
	return {
		x: Math.round(signed(hash & 0xff) * JITTER_MAX_PERCENT),
		y: Math.round(signed((hash >>> 8) & 0xff) * JITTER_MAX_PERCENT),
		tilt: Math.round(signed((hash >>> 16) & 0xff) * TILT_MAX_DEGREES)
	};
}

/**
 * The jitter as the three custom properties `ThreadSticker.svelte` consumes.
 *
 * Built here rather than interpolated in the template so that what lands in an
 * inline `style` attribute is provably three numbers and a unit — no part of it
 * comes from user input.
 */
export function stickerStyle(id: string): string {
	const { x, y, tilt } = stickerJitter(id);
	return `--jx: ${x}%; --jy: ${y}%; --tilt: ${tilt}deg`;
}
