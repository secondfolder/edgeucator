import { expect } from '@playwright/test';
import { test } from './fixtures';

/**
 * The halftone overlay on the logged-out landing page.
 *
 * This is the only level that can test it: the effect depends on html2canvas
 * parsing the page's real CSS, on WebGL, and on the browser actually
 * compositing — none of which exist under jsdom.
 *
 * The unhandled-rejection net matters here specifically: the overlay's first
 * version threw `Attempting to parse an unsupported color function "oklab"`
 * from a promise nothing awaited, so the page looked fine and only this
 * suite's pageerror watcher (see fixtures.ts) plus a pixels assertion can
 * tell a working overlay from a blank canvas.
 */
test('the halftone overlay paints over the landing page', async ({ page }) => {
	await page.goto('/');

	const canvas = page.locator('canvas.halftone');

	// The canvas is only sized once html2canvas-pro has captured the page and
	// the shader has drawn — width 0 means the effect never ran.
	await expect
		.poll(() => canvas.evaluate((el) => el.width), { timeout: 20_000 })
		.toBeGreaterThan(0);

	// Read the WebGL canvas back through a 2D canvas (a WebGL context cannot
	// hand out getImageData itself) and check ink actually landed. The context
	// is created with preserveDrawingBuffer for exactly this readback; without
	// it the buffer is cleared after compositing and this reads blank.
	const paintedFraction = await canvas.evaluate((el) => {
		const scratch = document.createElement('canvas');
		scratch.width = el.width;
		scratch.height = el.height;
		const ctx = scratch.getContext('2d')!;
		ctx.drawImage(el, 0, 0);
		const { data } = ctx.getImageData(0, 0, scratch.width, scratch.height);
		let painted = 0;
		for (let i = 3; i < data.length; i += 4) {
			if (data[i]! > 0) painted++;
		}
		return painted / (scratch.width * scratch.height);
	});

	// With noise strength at 0.5 the grain alone composites over roughly half
	// the page, so anything under a tenth of pixels carrying ink means the
	// shader drew nothing but the capture still "succeeded".
	expect(paintedFraction).toBeGreaterThan(0.1);

	// The grain must be *white* noise, not just any per-pixel texture. The
	// pure-noise background shows up as the most common translucent alpha in
	// the rendered frame: it is the overlay's noise floor with no ink laid on
	// top. Sample exactly those pixels and their neighbouring colour values
	// should differ strongly. The first version used the fract(sin(dot(...)))
	// hash, whose precision collapse at larger coordinates reads as diagonal
	// banding — adjacent pixels end up far too similar. A local-difference
	// check guards that directly and avoids overfitting the test to one exact
	// histogram shape, which changes as the landing's spacing/maxInk tuning
	// changes.
	const { dominantAlpha, pairs, meanNeighborDiff } = await canvas.evaluate((el) => {
		const scratch = document.createElement('canvas');
		scratch.width = el.width;
		scratch.height = el.height;
		const ctx = scratch.getContext('2d')!;
		ctx.drawImage(el, 0, 0);
		const { data } = ctx.getImageData(0, 0, scratch.width, scratch.height);
		const alphas = new Array(256).fill(0) as number[];
		for (let i = 3; i < data.length; i += 4) {
			const alpha = data[i]!;
			if (alpha === 0 || alpha === 255) continue;
			alphas[alpha]!++;
		}

		let dominantAlpha = 1;
		for (let alpha = 2; alpha < 255; alpha++) {
			if (alphas[alpha]! > alphas[dominantAlpha]!) dominantAlpha = alpha;
		}

		let pairs = 0;
		let diffSum = 0;
		for (let y = 0; y < scratch.height; y++) {
			for (let x = 0; x < scratch.width - 1; x++) {
				const i = (y * scratch.width + x) * 4;
				const j = i + 4;
				if (data[i + 3]! !== dominantAlpha || data[j + 3]! !== dominantAlpha) continue;
				diffSum += Math.abs(data[i]! - data[j]!);
				pairs++;
			}
		}
		return {
			dominantAlpha,
			pairs,
			meanNeighborDiff: pairs > 0 ? diffSum / pairs : 0
		};
	});

	// The exact count moves with the page tuning: wider spacing and finer ink
	// leave fewer untouched pixels than the earlier denser screen. We only
	// need enough background-noise pairs to judge the local variation.
	expect(dominantAlpha).toBeGreaterThan(0);
	expect(pairs).toBeGreaterThan(10_000);
	expect(meanNeighborDiff).toBeGreaterThan(20);
});
