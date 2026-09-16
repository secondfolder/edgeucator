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
		.poll(() => canvas.evaluate((el) => (el as HTMLCanvasElement).width), { timeout: 20_000 })
		.toBeGreaterThan(0);

	// Read the WebGL canvas back through a 2D canvas (a WebGL context cannot
	// hand out getImageData itself) and check ink actually landed. The context
	// is created with preserveDrawingBuffer for exactly this readback; without
	// it the buffer is cleared after compositing and this reads blank.
	const paintedFraction = await canvas.evaluate((el) => {
		const canvasEl = el as HTMLCanvasElement;
		const scratch = document.createElement('canvas');
		scratch.width = canvasEl.width;
		scratch.height = canvasEl.height;
		const ctx = scratch.getContext('2d')!;
		ctx.drawImage(canvasEl, 0, 0);
		const { data } = ctx.getImageData(0, 0, scratch.width, scratch.height);
		let painted = 0;
		for (let i = 3; i < data.length; i += 4) {
			if (data[i]! > 0) painted++;
		}
		return painted / (scratch.width * scratch.height);
	});

	// The current calibration targets Affinity's blend-free line halftone, so
	// the canvas is an opaque grayscale screen rather than a translucent ink
	// overlay. A render that paints under most pixels but leaves the frame
	// non-opaque or coloured is the wrong algorithm, not a stylistic variant.
	expect(paintedFraction).toBeGreaterThan(0.95);

	const { opaqueFraction, meanChannelDelta, leftMin, leftMax, rightMin, rightMax } =
		await canvas.evaluate((el) => {
			const canvasEl = el as HTMLCanvasElement;
			const scratch = document.createElement('canvas');
			scratch.width = canvasEl.width;
			scratch.height = canvasEl.height;
			const ctx = scratch.getContext('2d')!;
			ctx.drawImage(canvasEl, 0, 0);
			const { data } = ctx.getImageData(0, 0, scratch.width, scratch.height);
			let opaque = 0;
			let total = 0;
			let channelDeltaSum = 0;
			for (let i = 3; i < data.length; i += 4) {
				if (data[i]! >= 230) opaque++;
				channelDeltaSum +=
					Math.abs(data[i - 3]! - data[i - 2]!) + Math.abs(data[i - 2]! - data[i - 1]!);
				total++;
			}

			const sampleColumn = (x: number) => {
				let min = 255;
				let max = 0;
				for (let y = 0; y < scratch.height; y++) {
					const v = data[(y * scratch.width + x) * 4]!;
					if (v < min) min = v;
					if (v > max) max = v;
				}
				return { min: min / 255, max: max / 255 };
			};

			const left = sampleColumn(Math.floor(scratch.width * 0.05));
			const right = sampleColumn(Math.floor(scratch.width * 0.95));
			return {
				opaqueFraction: opaque / total,
				meanChannelDelta: channelDeltaSum / total,
				leftMin: left.min,
				leftMax: left.max,
				rightMin: right.min,
				rightMax: right.max
			};
		});
	expect(opaqueFraction).toBeGreaterThan(0.99);
	expect(meanChannelDelta).toBeLessThan(1);

	// At a 15 degree line angle the bands still run near-horizontally, so
	// vertical samples on both sides of the page's left-to-right gradient
	// should oscillate strongly. The bounds come from the model in
	// docs/halftone.md: at contrast 0.4 the slope is tan(36°) = 0.727, so a
	// tone t peaks at t·1.727 and troughs below zero for anything under 0.58.
	// The background runs #943700 (tone 0.30) to #711500 (tone 0.18), which
	// predicts crests near 0.52 on the left and 0.31 on the right, both on a
	// black floor, plus up to 0.078 of grain. Asserting the shape rather than
	// the numbers keeps this honest through tuning.
	expect(leftMin).toBeLessThan(0.05);
	expect(leftMax).toBeGreaterThan(0.4);
	expect(rightMin).toBeLessThan(0.05);
	expect(rightMax).toBeGreaterThan(0.25);
	expect(rightMax).toBeLessThan(0.5);
	expect(leftMax).toBeGreaterThan(rightMax + 0.05);
});
