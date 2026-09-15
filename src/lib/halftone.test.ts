import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import {
	applyMonochromeNoiseRgb,
	halftoneContrastSlope,
	halftoneNoiseDelta,
	halftoneScreenValue,
	renderHalftoneGrayscaleImage,
	renderSoftLightHalftoneImage,
	rgbToLuma,
	type HalftoneRenderOptions,
	type NormalizedRgbaImage
} from './halftone';
import { decodePngToNormalizedImage } from './testing/png';

/**
 * Regressions against the Affinity reference exports.
 *
 * `testing/halftone-fixtures/README.md` records the filter settings each PNG
 * was produced with. Two things about how they are compared here:
 *
 * - Errors are in 0-255 units, because that is what the references are
 *   quantised to and the only unit where a tolerance means something
 *   ("within a couple of levels").
 * - Comparisons exclude a border margin. Affinity's screen picks up a linear
 *   offset near the canvas edge — measurably a shift of the *screen*, since
 *   solving for it gives the same number at every contrast level, where
 *   solving for a tone change does not — and that is an artefact of a filter
 *   running on a bounded canvas. The overlay covers a whole viewport, so
 *   reproducing it would be wrong.
 */
function fixturePath(group: string, fileName: string): string {
	return fileURLToPath(
		new URL(`./testing/halftone-fixtures/${group}/${fileName}`, import.meta.url)
	);
}

function grayscaleFromImage(image: NormalizedRgbaImage): Float32Array {
	const out = new Float32Array(image.width * image.height);
	for (let index = 0; index < out.length; index += 1) {
		const rgbaIndex = index * 4;
		out[index] = rgbToLuma(
			image.rgba[rgbaIndex],
			image.rgba[rgbaIndex + 1],
			image.rgba[rgbaIndex + 2]
		);
	}
	return out;
}

/** Root mean squared error in 0-255 levels, ignoring `margin` px of border. */
function rmse255(
	actual: ArrayLike<number>,
	expected: ArrayLike<number>,
	width: number,
	height: number,
	margin = 0,
	channels = 1
): number {
	let error = 0;
	let count = 0;
	for (let y = margin; y < height - margin; y += 1) {
		for (let x = margin; x < width - margin; x += 1) {
			for (let channel = 0; channel < channels; channel += 1) {
				const index = (y * width + x) * channels + channel;
				const delta = actual[index] - expected[index];
				error += delta * delta;
				count += 1;
			}
		}
	}
	return Math.sqrt(error / count) * 255;
}

function statsOf(values: ArrayLike<number>): {
	min: number;
	max: number;
	mean: number;
	std: number;
} {
	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;
	let sum = 0;
	for (let index = 0; index < values.length; index += 1) {
		min = Math.min(min, values[index]);
		max = Math.max(max, values[index]);
		sum += values[index];
	}
	const mean = sum / values.length;
	let variance = 0;
	for (let index = 0; index < values.length; index += 1) {
		variance += (values[index] - mean) ** 2;
	}
	return { min, max, mean, std: Math.sqrt(variance / values.length) };
}

function lineOptions(overrides: Partial<HalftoneRenderOptions> = {}): HalftoneRenderOptions {
	return {
		pattern: 'line',
		angleRadians: 0,
		contrast: 0.75,
		cellSize: 33.6,
		noiseStrength: 0,
		drift: 0,
		...overrides
	};
}

describe('the halftone screen model', () => {
	it('is a triangle with its trough on the cell centre', () => {
		expect(halftoneScreenValue(0, 80)).toBeCloseTo(0, 6);
		expect(halftoneScreenValue(20, 80)).toBeCloseTo(0.5, 6);
		expect(halftoneScreenValue(40, 80)).toBeCloseTo(1, 6);
		expect(halftoneScreenValue(60, 80)).toBeCloseTo(0.5, 6);
		expect(halftoneScreenValue(80, 80)).toBeCloseTo(0, 6);
		// Even, which is what lets the shader mirror the y axis for free.
		expect(halftoneScreenValue(-13, 80)).toBeCloseTo(halftoneScreenValue(13, 80), 6);
	});

	it('maps contrast onto the tangent slope law', () => {
		expect(halftoneContrastSlope(0)).toBeCloseTo(0, 6);
		expect(halftoneContrastSlope(0.25)).toBeCloseTo(Math.SQRT2 - 1, 6);
		expect(halftoneContrastSlope(0.5)).toBeCloseTo(1, 6);
		expect(halftoneContrastSlope(0.75)).toBeCloseTo(Math.SQRT2 + 1, 6);
		expect(halftoneContrastSlope(1)).toBe(1e6);
	});

	it('leaves the image untouched at contrast 0', () => {
		const source = decodePngToNormalizedImage(fixturePath('contrast', 'no-filter.png'));
		const actual = renderHalftoneGrayscaleImage(source, lineOptions({ contrast: 0, cellSize: 80 }));
		expect(rmse255(actual, grayscaleFromImage(source), source.width, source.height)).toBeLessThan(
			0.01
		);
	});

	it('produces spatially white grain', () => {
		// The statistical comparison against the noise reference below only
		// checks the distribution, which a badly structured hash passes happily:
		// the sine hash it replaced had the right histogram and visible vertical
		// streaks. These assertions are about *arrangement*.
		const size = 192;
		const field = new Float64Array(size * size);
		for (let y = 0; y < size; y += 1) {
			for (let x = 0; x < size; x += 1) {
				field[y * size + x] = halftoneNoiseDelta(x + 0.5, y + 0.5, 1);
			}
		}
		const mean = field.reduce((sum, value) => sum + value, 0) / field.length;
		const variance = field.reduce((sum, value) => sum + (value - mean) ** 2, 0) / field.length;
		const standardDeviation = Math.sqrt(variance);

		// Triangular over ±40/255 has sd (40/255)/sqrt(6).
		expect(mean).toBeCloseTo(0, 2);
		expect(standardDeviation).toBeCloseTo(40 / 255 / Math.sqrt(6), 2);

		const autocorrelation = (dx: number, dy: number) => {
			let sum = 0;
			let count = 0;
			for (let y = 0; y < size - dy; y += 1) {
				for (let x = 0; x < size - dx; x += 1) {
					sum += (field[y * size + x] - mean) * (field[(y + dy) * size + x + dx] - mean);
					count += 1;
				}
			}
			return sum / count / variance;
		};
		for (const [dx, dy] of [
			[1, 0],
			[0, 1],
			[1, 1],
			[2, 0],
			[0, 2],
			[7, 3]
		]) {
			expect(Math.abs(autocorrelation(dx, dy)), `lag ${dx},${dy}`).toBeLessThan(0.05);
		}

		// Streaking shows up as row or column means that vary further than
		// averaging `size` independent samples could explain.
		const lineMean = (index: number, alongRow: boolean) => {
			let sum = 0;
			for (let step = 0; step < size; step += 1) {
				sum += field[alongRow ? index * size + step : step * size + index];
			}
			return sum / size;
		};
		for (const alongRow of [true, false]) {
			const means = Array.from({ length: size }, (_, index) => lineMean(index, alongRow));
			const meanOfMeans = means.reduce((sum, value) => sum + value, 0) / means.length;
			const spread = Math.sqrt(
				means.reduce((sum, value) => sum + (value - meanOfMeans) ** 2, 0) / means.length
			);
			expect(
				spread / (standardDeviation / Math.sqrt(size)),
				alongRow ? 'rows' : 'columns'
			).toBeLessThan(1.5);
		}
	});
});

describe('halftone reference regressions', () => {
	it('reproduces the Affinity contrast sweep at cell 80', () => {
		const source = decodePngToNormalizedImage(fixturePath('contrast', 'no-filter.png'));
		// The strip is 10 px wide, so the border margin has to be taken in y
		// only: the edge artefact runs in from the top and bottom.
		const margin = 95;
		const rows = source.height - margin * 2;
		const crop = (values: ArrayLike<number>) =>
			Array.from(
				{ length: rows * source.width },
				(_, index) => values[index + margin * source.width]
			);
		for (const [fileName, contrast, tolerance] of [
			['filter-0-contrast.png', 0, 0.5],
			['filter-25-contrast.png', 0.25, 3],
			['filter-50-contrast.png', 0.5, 3],
			['filter-75-contrast.png', 0.75, 3.5],
			// A hard threshold disagrees by a full 255 wherever the crossing row
			// is ambiguous, which one row per cell inevitably is.
			['filter-100-contrast.png', 1, 30]
		] as const) {
			const expected = grayscaleFromImage(
				decodePngToNormalizedImage(fixturePath('contrast', fileName))
			);
			const actual = renderHalftoneGrayscaleImage(source, lineOptions({ contrast, cellSize: 80 }));
			expect(rmse255(crop(actual), crop(expected), source.width, rows), fileName).toBeLessThan(
				tolerance
			);
		}
	});

	it('reproduces the 33.6 px contrast-75 references at 0, 15 and 45 degrees', () => {
		const source = decodePngToNormalizedImage(
			fixturePath('shape-2', 'without-halftone-filter.png')
		);
		for (const [fileName, angleRadians, tolerance] of [
			['with-halftone-filter-0-deg.png', 0, 2.5],
			['with-halftone-filter-15-deg.png', Math.PI / 12, 9],
			['with-halftone-filter-45-deg.png', Math.PI / 4, 5]
		] as const) {
			const expected = grayscaleFromImage(
				decodePngToNormalizedImage(fixturePath('shape-2', fileName))
			);
			const actual = renderHalftoneGrayscaleImage(source, lineOptions({ angleRadians }));
			expect(rmse255(actual, expected, source.width, source.height, 20), fileName).toBeLessThan(
				tolerance
			);
		}
	});

	it('keeps the ink coverage of a fully thresholded screen equal to 1 - tone', () => {
		// The property that makes a triangle the right screen: at contrast 1 the
		// black fraction of a cell equals the ink fraction of the tone, so the
		// filter reproduces tone linearly instead of crushing it.
		const width = 16;
		const height = 800;
		const image: NormalizedRgbaImage = {
			width,
			height,
			rgba: new Float32Array(width * height * 4)
		};
		for (let index = 0; index < width * height; index += 1) {
			image.rgba.set([0.4, 0.4, 0.4, 1], index * 4);
		}
		const rendered = renderHalftoneGrayscaleImage(
			image,
			lineOptions({ contrast: 1, cellSize: 80 })
		);
		let ink = 0;
		for (const value of rendered) if (value < 0.5) ink += 1;
		expect(ink / rendered.length).toBeCloseTo(0.6, 2);
	});

	it('matches the 50 percent monochrome noise reference statistically', () => {
		const base = decodePngToNormalizedImage(fixturePath('noise', 'no-noise.png'));
		const expected = decodePngToNormalizedImage(fixturePath('noise', '50-percent-noise.png'));
		// The reference source is solid #FFC621, so red is already at 255: every
		// positive delta clips there and the channel's statistics say more about
		// Affinity's clipping than about its grain. Green and blue are clear of
		// both ends and carry the assertions.
		const channels = [0, 1, 2].map(() => ({ actual: [] as number[], expected: [] as number[] }));
		for (let y = 0; y < base.height; y += 1) {
			for (let x = 0; x < base.width; x += 1) {
				const index = (y * base.width + x) * 4;
				const noised = applyMonochromeNoiseRgb(
					base.rgba[index],
					base.rgba[index + 1],
					base.rgba[index + 2],
					x + 0.5,
					y + 0.5,
					0.5
				);
				for (let channel = 0; channel < 3; channel += 1) {
					channels[channel].actual.push(noised[channel] - base.rgba[index + channel]);
					channels[channel].expected.push(
						expected.rgba[index + channel] - base.rgba[index + channel]
					);
				}
			}
		}
		for (const [channel, name] of [
			[1, 'green'],
			[2, 'blue']
		] as const) {
			const actual = statsOf(channels[channel].actual);
			const reference = statsOf(channels[channel].expected);
			expect(Math.abs(actual.mean - reference.mean), `${name} mean`).toBeLessThan(0.01);
			expect(Math.abs(actual.std - reference.std), `${name} std`).toBeLessThan(0.01);
		}
		// Peak deviation is checked on blue alone. Affinity's grain is only
		// *mostly* monochrome (the channels correlate at 0.95, not 1.0), so
		// green carries a few outliers past the shared envelope that an
		// extreme-value assertion would chase forever.
		const blue = statsOf(channels[2].actual);
		const blueReference = statsOf(channels[2].expected);
		expect(Math.abs(blue.min - blueReference.min), 'blue min').toBeLessThan(0.005);
		expect(Math.abs(blue.max - blueReference.max), 'blue max').toBeLessThan(0.005);
	});

	it('matches the soft-light reference', () => {
		// The `shape` / `soft-light` pair does not reproduce at its recorded
		// settings: fitting the model to it lands on cell 52.2 / contrast 43.5
		// rather than 50 / 50, and its whole 100 px frame sits inside the edge
		// artefact. It is kept as a blend check and rendered with the fitted
		// screen, so the assertion is about soft-light and not the cell size.
		const source = decodePngToNormalizedImage(
			fixturePath('soft-light', 'without-halftone-filter.png')
		);
		const expected = decodePngToNormalizedImage(
			fixturePath('soft-light', 'with-halftone-filter-and-soft-light.png')
		);
		const actual = renderSoftLightHalftoneImage(
			source,
			lineOptions({ contrast: 0.435, cellSize: 52.15 })
		);
		expect(rmse255(actual, expected.rgba, source.width, source.height, 20, 4)).toBeLessThan(14);
	});
});
