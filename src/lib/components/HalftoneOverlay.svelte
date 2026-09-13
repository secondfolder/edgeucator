<script lang="ts">
	import { onMount } from 'svelte';

	/**
	 * A halftone "concentric rings" overlay rendered over the live page.
	 *
	 * The page is captured with html2canvas, then a WebGL fragment shader
	 * re-renders it as ink rings whose thickness follows local luminance:
	 * each fragment averages the OKLab lightness of the radial band its ring
	 * cell covers, and dark cells get thick ink while light cells thin out.
	 * The canvas itself is transparent except for ink, and sits over the page
	 * with `mix-blend-mode: soft-light` so the content shows through.
	 *
	 * html2canvas is imported dynamically inside onMount so it never enters
	 * the SSR graph — it touches `document`/`window` at module scope and the
	 * server bundle must stay free of browser-only libraries.
	 */
	interface Props {
		/** Distance between ring centerlines, in CSS px. */
		spacing?: number;
		/** 0..1. Higher = harder ring edges. */
		contrast?: number;
		/** Caps how much of a band the ink may fill, 0..1. */
		maxInk?: number;
		/** 0..1 white-noise grain composited over the rings. */
		noiseStrength?: number;
		/** Outward drift of the rings, in CSS px per second. */
		speed?: number;
	}

	let {
		spacing = 10,
		contrast = 0.5,
		maxInk = 1,
		noiseStrength = 0.5,
		speed = 4
	}: Props = $props();

	let canvas: HTMLCanvasElement;

	const vertSrc = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

	// Ported from the prototype: sRGB → linear → OKLab lightness, band
	// averaging along the radial strip each ring cell covers, soft-edged ink
	// whose half-width is darkness × maxInk × spacing/2, with white noise
	// composited over it via the Porter-Duff "over" operator so both the
	// grain and the ink stay correctly transparent. Invert is deliberately
	// omitted — this deployment always puts ink on dark areas.
	const fragSrc = `
precision highp float;
uniform sampler2D uImage;
uniform vec2 uResolution;
uniform vec2 uCenter;
uniform float uSpacing;
uniform float uContrast;
uniform float uMaxInk;
uniform float uNoiseStrength;
uniform float uTime; // seconds since mount — drives the outward ring drift
uniform float uSpeed; // px/s outward drift

vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
float cbrtSafe(float x) { return sign(x) * pow(abs(x), 1.0 / 3.0); }
float oklabLightness(vec3 lin) {
  float l = 0.4122214708 * lin.r + 0.5363325363 * lin.g + 0.0514459929 * lin.b;
  float m = 0.2119034982 * lin.r + 0.6806995451 * lin.g + 0.1073969566 * lin.b;
  float s = 0.0883024619 * lin.r + 0.2817188376 * lin.g + 0.6299787005 * lin.b;
  float l_ = cbrtSafe(l);
  float m_ = cbrtSafe(m);
  float s_ = cbrtSafe(s);
  return 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
}

void main() {
  vec2 delta = gl_FragCoord.xy - uCenter;
  float radius = length(delta);
  float angle = atan(delta.y, delta.x);
  vec2 dir = vec2(cos(angle), sin(angle));

  // The drift shifts every ring outward continuously: subtracting it from
  // the radius before the floor() and adding it back to the centerline makes
  // each ring index's centerline advance at uSpeed px/s, so the pattern
  // radiates gently out from uCenter. The luminance band is sampled at the
  // drifted centerline, so a ring carries its own ink as it travels.
  float drift = uTime * uSpeed;
  float ringIndex = floor((radius - drift) / uSpacing + 0.5);
  float ringCenterRadius = ringIndex * uSpacing + drift;

  // Average luminance across the full radial band this ring cell covers,
  // not just the centerline point.
  const int SAMPLES = 10;
  float halfSpacing = uSpacing * 0.5;
  float bandStart = ringCenterRadius - halfSpacing;
  vec3 sumLinear = vec3(0.0);
  for (int i = 0; i < SAMPLES; i++) {
    float t = (float(i) + 0.5) / float(SAMPLES);
    float r = max(bandStart + t * uSpacing, 0.0);
    vec2 samplePos = uCenter + dir * r;
    vec2 sUv = clamp(samplePos / uResolution, 0.0, 1.0);
    sUv.y = 1.0 - sUv.y;
    sumLinear += srgbToLinear(texture2D(uImage, sUv).rgb);
  }
  vec3 avgLinear = sumLinear / float(SAMPLES);
  float L = clamp(oklabLightness(avgLinear), 0.0, 1.0);
  float darkness = 1.0 - L;

  float distToLine = abs(radius - ringCenterRadius);
  float halfWidth = darkness * uMaxInk * halfSpacing;
float edgeSoft = max(mix(uSpacing * 0.5, 0.6, uContrast), 0.4);
	// The prototype tied edge softness to the full ring spacing, which makes
	// it dominate at wider spacings: with spacing 20, edgeSoft was ~5 px while
	// halfWidth at maxInk 0.01..0.1 was only 0.1..1 px, so changing maxInk
	// barely moved the visible ring width at all. Soften relative to the
	// intended ink width instead: low maxInk now really does mean finer lines,
	// while contrast still controls how hard their edges are.
	// float edgeSoft = max(mix(max(halfWidth, 0.25), 0.25, uContrast), 0.15);

  float ink = clamp(1.0 - smoothstep(halfWidth - edgeSoft, halfWidth + edgeSoft, distToLine), 0.0, 1.0);

  // Sine-free per-pixel hash (Dave Hoskins, "hash without sine"). The
  // prototype used the classic fract(sin(dot(...))) hash, whose sin argument
  // grows with pixel coordinate — GPUs compute it in limited precision, so at
  // larger coordinates neighbouring pixels collapse onto nearby sin values
  // and the "noise" comes out as diagonal banding rather than white noise.
  // This one is all multiplies and fracts, which stay exact enough.
  vec3 p3 = fract(vec3(gl_FragCoord.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  float noiseRand = fract((p3.x + p3.y) * p3.z);
  vec3 noiseColor = vec3(noiseRand);
  float noiseAlpha = clamp(uNoiseStrength, 0.0, 1.0);

  float outAlpha = ink + noiseAlpha * (1.0 - ink);
  vec3 outColor = outAlpha > 0.0001 ? (noiseColor * noiseAlpha * (1.0 - ink)) / outAlpha : vec3(0.0);
  gl_FragColor = vec4(outColor, clamp(outAlpha, 0.0, 1.0));
}`;

	onMount(() => {
		const userAgent = navigator.userAgent;
		const isSafari =
			navigator.vendor === 'Apple Computer, Inc.' &&
			!/CriOS|FxiOS|EdgiOS|Chrome|Chromium|Android/.test(userAgent);
		if (isSafari) {
			// Safari's soft-light compositing comes out visibly punchier on this
			// grayscale overlay than Chromium's, so its final opacity is reduced.
			// Using the fade target rather than an extra wrapper keeps the first
			// reveal animation and the runtime path identical across browsers.
			canvas.style.setProperty('--overlay-opacity', '0.3');
		}

		// preserveDrawingBuffer so the composited frame survives past the
		// browser's composite step — without it, reading the canvas back (as the
		// e2e spec does to assert the overlay actually painted) races the buffer
		// clear and can read all-transparent pixels even after a good render.
		const maybeGl = canvas.getContext('webgl', { preserveDrawingBuffer: true });
		if (!maybeGl) return;
		// Narrowed alias: TS does not carry the null-guard above into the
		// nested render()/capture() closures, and re-checking there would be
		// noise — by this point the context exists for the component's life.
		const gl: WebGLRenderingContext = maybeGl;

		const compile = (type: number, src: string) => {
			const shader = gl.createShader(type)!;
			gl.shaderSource(shader, src);
			gl.compileShader(shader);
			return shader;
		};
		const prog = gl.createProgram()!;
		gl.attachShader(prog, compile(gl.VERTEX_SHADER, vertSrc));
		gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fragSrc));
		gl.linkProgram(prog);
		gl.useProgram(prog);

		const buf = gl.createBuffer()!;
		gl.bindBuffer(gl.ARRAY_BUFFER, buf);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
		const aPos = gl.getAttribLocation(prog, 'aPos');
		gl.enableVertexAttribArray(aPos);
		gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

		const uResolution = gl.getUniformLocation(prog, 'uResolution');
		const uCenter = gl.getUniformLocation(prog, 'uCenter');
		const uSpacing = gl.getUniformLocation(prog, 'uSpacing');
		const uContrast = gl.getUniformLocation(prog, 'uContrast');
		const uMaxInk = gl.getUniformLocation(prog, 'uMaxInk');
		const uNoiseStrength = gl.getUniformLocation(prog, 'uNoiseStrength');
		const uTime = gl.getUniformLocation(prog, 'uTime');
		const uSpeed = gl.getUniformLocation(prog, 'uSpeed');

		const texture = gl.createTexture()!;
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

		function render(timeSeconds: number) {
			gl.viewport(0, 0, canvas.width, canvas.height);
			gl.uniform2f(uResolution, canvas.width, canvas.height);
			// gl_FragCoord y runs bottom-up; the picked center is top-down.
			gl.uniform2f(uCenter, canvas.width / 2, canvas.height / 2);
			gl.uniform1f(uSpacing, spacing);
			gl.uniform1f(uContrast, contrast);
			gl.uniform1f(uMaxInk, maxInk);
			gl.uniform1f(uNoiseStrength, noiseStrength);
			gl.uniform1f(uTime, timeSeconds);
			gl.uniform1f(uSpeed, speed);
			gl.uniform1i(gl.getUniformLocation(prog, 'uImage'), 0);
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, texture);

			gl.clearColor(0, 0, 0, 0);
			gl.clear(gl.COLOR_BUFFER_BIT);
			gl.drawArrays(gl.TRIANGLES, 0, 3);
		}

		function measureBounds() {
			const { documentElement, body } = document;
			return {
				viewportWidth: window.innerWidth,
				viewportHeight: window.innerHeight,
				captureWidth: Math.max(
					documentElement.scrollWidth,
					documentElement.clientWidth,
					body.scrollWidth,
					body.clientWidth
				),
				captureHeight: Math.max(
					documentElement.scrollHeight,
					documentElement.clientHeight,
					body.scrollHeight,
					body.clientHeight
				)
			};
		}

		// The drift makes the shader time-dependent, so it re-renders every
		// frame from rAF. requestAnimationFrame timestamps are relative to the
		// page's time origin, not this component's mount — anchor on the first
		// callback so the rings start still and ease into motion, and so the
		// drift stays bounded however long the tab lives.
		let captureInFlight = false;
		let captureQueued = false;
		let lastBounds = measureBounds();
		let start: number | null = null;
		let rafId = 0;
		const tick = (now: number) => {
			if (start === null) start = now;
			const bounds = measureBounds();
			if (
				bounds.viewportWidth !== lastBounds.viewportWidth ||
				bounds.viewportHeight !== lastBounds.viewportHeight ||
				bounds.captureWidth !== lastBounds.captureWidth ||
				bounds.captureHeight !== lastBounds.captureHeight
			) {
				lastBounds = bounds;
				captureQueued = true;
				if (!captureInFlight) void capture();
			}
			render((now - start) / 1000);
			rafId = requestAnimationFrame(tick);
		};
		rafId = requestAnimationFrame(tick);

		let cancelled = false;

		async function capture() {
			captureQueued = false;
			captureInFlight = true;
			// html2canvas-pro, not html2canvas: the original's CSS parser throws
			// `Attempting to parse an unsupported color function "oklab"` on the
			// oklab()/oklch() colors Web Awesome's stylesheet is written in (and
			// that Chromium's getComputedStyle hands back verbatim). -pro is the
			// maintained fork whose parser understands modern color functions.
			const { default: html2canvas } = await import('html2canvas-pro');
			if (cancelled) {
				captureInFlight = false;
				return;
			}
			// The overlay itself must not feed the capture it is drawn from:
			// excluding it here is what keeps the feedback loop out.
			const captured = await html2canvas(document.body, {
				backgroundColor: null,
				scale: 1, // 1 canvas px = 1 CSS px so the rings line up exactly
				useCORS: true,
				logging: false,
				ignoreElements: (el) => el === canvas
			});
			if (cancelled) {
				captureInFlight = false;
				return;
			}

			canvas.width = captured.width;
			canvas.height = captured.height;
			canvas.style.width = `${captured.width}px`;
			canvas.style.height = `${captured.height}px`;

			gl.bindTexture(gl.TEXTURE_2D, texture);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, captured);
			// Fade in rather than popping: the capture takes a beat (html2canvas
			// walks the DOM), during which the canvas is sized 0 and invisible.
			// Revealing it with a CSS transition covers the seam between "the
			// page has loaded" and "the effect has rendered". The class stays
			// across recaptures — only the first reveal is animated.
			canvas.classList.add('ready');
			// No explicit render here: the rAF loop draws the next frame with
			// the fresh texture, which is never more than one frame away.
			captureInFlight = false;
			const bounds = measureBounds();
			const changedSinceStart =
				bounds.viewportWidth !== lastBounds.viewportWidth ||
				bounds.viewportHeight !== lastBounds.viewportHeight ||
				bounds.captureWidth !== lastBounds.captureWidth ||
				bounds.captureHeight !== lastBounds.captureHeight;
			lastBounds = bounds;
			if (captureQueued || changedSinceStart) {
				captureQueued = true;
				void capture();
			}
		}

		void capture();

		return () => {
			cancelled = true;
			cancelAnimationFrame(rafId);
		};
	});
</script>

<!-- pointer-events: none keeps the overlay decorative — links underneath stay
     clickable. blend mode is the "transparent ink" mode from the prototype. -->
<!-- width/height start at 0 (not the 300×150 default) so anything that waits
     on the canvas being sized — the e2e spec's poll, chiefly — is waiting on
     the capture having run, not on the element merely existing. -->
<canvas bind:this={canvas} class="halftone" width="0" height="0" aria-hidden="true"></canvas>

<style>
	.halftone {
		/* Viewport-centred rather than top-left anchored: if html2canvas is one
		   capture behind during a resize, the stale frame may be too large or too
		   small for a beat, but its centre still sits on the viewport centre so
		   the rings' origin stays visually locked in place. The temporary failure
		   mode becomes clipped edges rather than a drifting target. */
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		pointer-events: none;
		z-index: 9999;
		mix-blend-mode: soft-light;

		/* Hidden until the first capture lands, then faded in (see the
		   `ready` class note in capture()). :global because the class is added
		   imperatively from onMount, which the compiler cannot see — a scoped
		   selector would be pruned as unused and the canvas would stay at
		   opacity 0. Transitions only run in the browser, and jsdom never runs
		   capture(), so tests are unaffected either way. */
		--overlay-opacity: 1;
		opacity: 0;
		transition: opacity 1.2s ease-out;

		&:global(.ready) {
			opacity: var(--overlay-opacity);
		}
	}
</style>
