export type HalftonePattern = 'circle' | 'line';

export interface NormalizedRgbaImage {
	width: number;
	height: number;
	rgba: Float32Array;
}

export interface HalftoneRenderOptions {
	pattern?: HalftonePattern;
	angleRadians?: number;
	/** 0..1, matching Affinity's 0..100 contrast slider divided by 100. */
	contrast: number;
	/** Distance between adjacent line centres (or rings), in pixels. */
	cellSize: number;
	/** 0..1, matching Affinity's 0..100 noise slider divided by 100. */
	noiseStrength: number;
	/** Pattern offset along the screen axis, in pixels. */
	drift?: number;
	centerX?: number;
	centerY?: number;
}

export const HALFTONE_CAPTURE_IGNORE_SELECTOR = '[data-halftone-ignore="true"]';

/**
 * Peak deviation of the grain at noise strength 1, in 0..1 units.
 *
 * Measured from `testing/halftone-fixtures/noise`: at strength 0.5 the
 * per-channel delta spans exactly ±20/255 with a standard deviation of
 * 8.12/255. A triangular distribution over ±20/255 has sd 20/255/sqrt(6) =
 * 8.16/255, which is why the grain is two hashes summed rather than one.
 */
export const HALFTONE_NOISE_AMPLITUDE = 40 / 255;

export function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}

export function fract(value: number): number {
	return value - Math.floor(value);
}

export function mix(start: number, end: number, amount: number): number {
	return start + (end - start) * amount;
}

/**
 * Rec.601 luma on the sRGB values directly, with no linearisation.
 *
 * Confirmed exactly by the contrast-0 reference, which is the filter's
 * grayscale pass with the screen switched off: solid #FFC621 comes back as
 * 196/255, which is Rec.601 (196.2) and not Rec.709 (198.2) or the channel
 * mean (162).
 */
export function rgbToLuma(red: number, green: number, blue: number): number {
	return red * 0.299 + green * 0.587 + blue * 0.114;
}

/**
 * The screen: a symmetric triangle wave over one cell, 0 at the cell centre
 * rising to 1 at the cell edge.
 *
 * A triangle is uniformly distributed, so thresholding it at `1 - tone` covers
 * exactly `1 - tone` of the area — the screen reproduces tone linearly, which
 * is what the contrast-100 reference does (a 0.7695 tone leaves an 18 px black
 * band per 80 px cell).
 */
export function halftoneScreenValue(coordAlong: number, cellSize: number): number {
	const phase = fract(coordAlong / cellSize);
	return phase < 0.5 ? phase * 2 : 2 - phase * 2;
}

/**
 * Affinity's contrast slider is the classic tangent slope law.
 *
 * Fitted against the cell-80 sweep, where the measured screen slope per pixel
 * gives 0.4165 / 0.9945 / 2.431 at contrast 25 / 50 / 75 — that is tan(22.5°),
 * tan(45°) and tan(67.5°) to within a quantisation step. Contrast 0 is a flat
 * grayscale pass and contrast 100 is a hard threshold, and both fall out of
 * the same formula.
 */
export function halftoneContrastSlope(contrast: number): number {
	// tan() reaches ~1.6e16 at exactly 1; cap it so the shader's highp float
	// cannot produce an Inf/NaN while still acting as a hard threshold.
	return Math.min(Math.tan((Math.PI / 2) * clamp01(contrast)), 1e6);
}

/**
 * The whole filter, per pixel.
 *
 * `tone + slope * (screen - (1 - tone))` pivots on the point where the screen
 * crosses the ink threshold: there the output is the tone itself whatever the
 * contrast, which is why every curve in the reference sweep passes through the
 * same two rows per cell.
 */
export function renderHalftoneScreenValue(
	gray: number,
	coordAlong: number,
	cellSize: number,
	contrast: number
): number {
	const screen = halftoneScreenValue(coordAlong, cellSize);
	return clamp01(gray + halftoneContrastSlope(contrast) * (screen - (1 - gray)));
}

/**
 * A uniform 0..1 value per pixel.
 *
 * Not the usual `fract(sin(dot(p, k)) * 43758.5453)`: that one is fine in
 * float64 but degrades on the GPU, where `sin` of a ~150000 radian argument
 * loses most of its mantissa. Measured in Chromium against the real WebGL
 * context, it produced grain with a standard deviation of 44/255 instead of
 * 52/255 and visible vertical streaking. This mixes by multiplication only —
 * every intermediate stays under 100, so float32 keeps it exact — and measures
 * 52.15/255 with autocorrelation under 0.006 at every lag, on both paths.
 */
export function halftoneNoiseHash(x: number, y: number): number {
	let qx = fract(x * 0.1031);
	let qy = fract(y * 0.103);
	let mixed = qx * (qy + 33.33) + qy * (qx + 33.33);
	qx = fract(qx + mixed);
	qy = fract(qy + mixed);
	mixed = qx * (qy + 19.19) + qy * (qx + 19.19);
	qx = fract(qx + mixed);
	qy = fract(qy + mixed);
	return fract(qx * qy * 97);
}

/** Offsets for the second tap; arbitrary, chosen to decorrelate the pair. */
const NOISE_SECOND_TAP_OFFSET = { x: 137.17, y: 91.31 };

export function halftoneNoiseDelta(x: number, y: number, noiseStrength: number): number {
	const first = halftoneNoiseHash(x, y);
	const second = halftoneNoiseHash(x + NOISE_SECOND_TAP_OFFSET.x, y + NOISE_SECOND_TAP_OFFSET.y);
	return (first + second - 1) * HALFTONE_NOISE_AMPLITUDE * noiseStrength;
}

export function applyHalftoneNoise(
	value: number,
	x: number,
	y: number,
	noiseStrength: number
): number {
	return clamp01(value + halftoneNoiseDelta(x, y, noiseStrength));
}

/** The grain is monochrome: one delta added to all three channels. */
export function applyMonochromeNoiseRgb(
	red: number,
	green: number,
	blue: number,
	x: number,
	y: number,
	noiseStrength: number
): [number, number, number] {
	const delta = halftoneNoiseDelta(x, y, noiseStrength);
	return [clamp01(red + delta), clamp01(green + delta), clamp01(blue + delta)];
}

export function softLightChannel(base: number, blend: number): number {
	if (blend <= 0.5) {
		return base - (1 - 2 * blend) * base * (1 - base);
	}
	const transformed = base <= 0.25 ? ((16 * base - 12) * base + 4) * base : Math.sqrt(base);
	return base + (2 * blend - 1) * (transformed - base);
}

export function softLightGrayOnRgb(
	red: number,
	green: number,
	blue: number,
	blendGray: number
): [number, number, number] {
	return [
		clamp01(softLightChannel(red, blendGray)),
		clamp01(softLightChannel(green, blendGray)),
		clamp01(softLightChannel(blue, blendGray))
	];
}

/**
 * Distance along the screen axis, measured from the image centre.
 *
 * The centre is where the screen's phase is zero: in the cell-80 reference the
 * minima land on rows 9.5 + 80k of a 500 px image, and 249.5 is one of them.
 * Angle is measured from horizontal with y running down the image, matching
 * the 15 and 45 degree references.
 */
export function halftoneCoordAlong(
	pattern: HalftonePattern,
	x: number,
	y: number,
	angleRadians: number,
	centerX: number,
	centerY: number
): number {
	const deltaX = x - centerX;
	const deltaY = y - centerY;
	if (pattern === 'circle') return Math.hypot(deltaX, deltaY);
	return deltaX * Math.sin(angleRadians) + deltaY * Math.cos(angleRadians);
}

/**
 * Tone is read straight from the pixel — the filter does not pre-blur.
 *
 * Worth stating because it is the obvious thing to assume: an earlier version
 * averaged the source along the screen axis, and dropping that is most of what
 * took the 33.6 px / contrast-75 references from visibly wrong to 1.6/255 RMSE.
 */
export function renderHalftoneGrayscalePixel(
	image: NormalizedRgbaImage,
	x: number,
	y: number,
	options: HalftoneRenderOptions
): number {
	const index = (y * image.width + x) * 4;
	const gray = rgbToLuma(image.rgba[index], image.rgba[index + 1], image.rgba[index + 2]);
	const coordAlong =
		halftoneCoordAlong(
			options.pattern ?? 'line',
			x + 0.5,
			y + 0.5,
			options.angleRadians ?? 0,
			options.centerX ?? image.width / 2,
			options.centerY ?? image.height / 2
		) - (options.drift ?? 0);
	const value = renderHalftoneScreenValue(gray, coordAlong, options.cellSize, options.contrast);
	return applyHalftoneNoise(value, x + 0.5, y + 0.5, options.noiseStrength);
}

export function renderHalftoneGrayscaleImage(
	image: NormalizedRgbaImage,
	options: HalftoneRenderOptions
): Float32Array {
	const out = new Float32Array(image.width * image.height);
	for (let y = 0; y < image.height; y += 1) {
		for (let x = 0; x < image.width; x += 1) {
			out[y * image.width + x] = renderHalftoneGrayscalePixel(image, x, y, options);
		}
	}
	return out;
}

export function renderSoftLightHalftoneImage(
	image: NormalizedRgbaImage,
	options: HalftoneRenderOptions
): Float32Array {
	const halftone = renderHalftoneGrayscaleImage(image, options);
	const out = new Float32Array(image.width * image.height * 4);
	for (let index = 0; index < image.width * image.height; index += 1) {
		const rgbaIndex = index * 4;
		const [red, green, blue] = softLightGrayOnRgb(
			image.rgba[rgbaIndex],
			image.rgba[rgbaIndex + 1],
			image.rgba[rgbaIndex + 2],
			halftone[index]
		);
		out[rgbaIndex] = red;
		out[rgbaIndex + 1] = green;
		out[rgbaIndex + 2] = blue;
		out[rgbaIndex + 3] = 1;
	}
	return out;
}

function formatFloat(value: number): string {
	const fixed = value.toFixed(7);
	const trimmed = fixed.replace(/\.0+$|(?<=\..*?)0+$/g, '').replace(/\.$/, '');
	return /[.eE]/.test(trimmed) ? trimmed : `${trimmed}.0`;
}

/**
 * The GPU half of the same model. Keep it in step with the functions above —
 * `halftone.test.ts` only exercises the CPU path.
 */
export function buildHalftoneFragmentShader(): string {
	return `
precision highp float;
uniform sampler2D uImage;
uniform vec2 uResolution;
uniform vec2 uCenter;
uniform int uPattern;
uniform float uAngle;
uniform float uContrast;
uniform float uCellSize;
uniform float uNoiseStrength;
uniform float uTime;
uniform float uSpeed;

float noiseHash(vec2 p) {
	vec2 q = fract(p * vec2(0.1031, 0.1030));
	q += dot(q, q.yx + 33.33);
	q = fract(q);
	q += dot(q, q.yx + 19.19);
	q = fract(q);
	return fract(q.x * q.y * 97.0);
}

void main() {
	// gl_FragCoord.y runs up while the captured texture (and the reference
	// renders) run down, so the screen axis is mirrored in y. The triangle is
	// an even function, so mirroring the whole coordinate is free and only the
	// sin term needs the sign flip.
	float coordAlong;
	if (uPattern == 0) {
		coordAlong = length(gl_FragCoord.xy - uCenter);
	} else {
		coordAlong = dot(gl_FragCoord.xy - uCenter, vec2(-sin(uAngle), cos(uAngle)));
	}
	coordAlong -= uTime * uSpeed;

	vec2 uv = clamp(gl_FragCoord.xy / uResolution, 0.0, 1.0);
	uv.y = 1.0 - uv.y;
	float gray = clamp(dot(texture2D(uImage, uv).rgb, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);

	float phase = fract(coordAlong / uCellSize);
	float screen = phase < 0.5 ? phase * 2.0 : 2.0 - phase * 2.0;
	float slope = min(tan(1.5707963 * clamp(uContrast, 0.0, 1.0)), 1000000.0);
	float value = clamp(gray + slope * (screen - (1.0 - gray)), 0.0, 1.0);

	vec2 grain = vec2(
		noiseHash(gl_FragCoord.xy),
		noiseHash(gl_FragCoord.xy + vec2(${formatFloat(NOISE_SECOND_TAP_OFFSET.x)}, ${formatFloat(NOISE_SECOND_TAP_OFFSET.y)}))
	);
	float grained = clamp(
		value + (grain.x + grain.y - 1.0) * ${formatFloat(HALFTONE_NOISE_AMPLITUDE)} * uNoiseStrength,
		0.0,
		1.0
	);
	gl_FragColor = vec4(vec3(grained), 1.0);
}`;
}
