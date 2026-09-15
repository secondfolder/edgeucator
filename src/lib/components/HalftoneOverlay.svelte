<script lang="ts">
	import { onMount } from 'svelte';
	import { HALFTONE_CAPTURE_IGNORE_SELECTOR, buildHalftoneFragmentShader } from '$lib/halftone';

	/**
	 * A halftone overlay rendered over the live page.
	 *
	 * The page is captured with html2canvas, then a WebGL fragment shader
	 * re-renders it as a grayscale halftone screen matching Affinity's Halftone
	 * filter. The model — Rec.601 luma, a triangle screen, and a tangent
	 * contrast slope — is documented in [docs/halftone.md](../../../docs/halftone.md)
	 * and lives in `$lib/halftone`, which the shader source is generated from so
	 * the CPU reference renderer and the GPU path cannot drift apart.
	 *
	 * html2canvas is imported dynamically inside onMount so it never enters
	 * the SSR graph — it touches `document`/`window` at module scope and the
	 * server bundle must stay free of browser-only libraries.
	 */
	interface Props {
		/** Which halftone motif to draw: concentric rings or parallel lines. */
		pattern?: 'circle' | 'line';
		/** Line pattern only: the angle of the lines, in degrees from horizontal. */
		angle?: number;
		/** 0..1, Affinity's 0..100 contrast slider over 100. 0 is a plain
		 * grayscale pass; 1 is a hard black-and-white threshold. */
		contrast?: number;
		/** Size of one halftone cell, in CSS px: the distance between
		 * adjacent ring/line peaks. */
		cellSize?: number;
		/** 0..1, Affinity's 0..100 noise slider over 100. Higher is allowed, but
		 * grain wide enough to clip only survives mid-band and reads as the
		 * band pattern — see docs/halftone.md. */
		noiseStrength?: number;
		/** Pattern drift, in CSS px per second. */
		speed?: number;
	}

	let {
		pattern = 'circle',
		angle = 0,
		contrast = 0.5,
		cellSize = 10,
		noiseStrength = 0.5,
		speed = 0
	}: Props = $props();

	let canvas: HTMLCanvasElement;

	const vertSrc = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

	const fragSrc = buildHalftoneFragmentShader();

	onMount(() => {
		const userAgent = navigator.userAgent;
		const isSafari =
			navigator.vendor === 'Apple Computer, Inc.' &&
			!/CriOS|FxiOS|EdgiOS|Chrome|Chromium|Android/.test(userAgent);
		if (isSafari) {
			// Safari's soft-light compositing still reads punchier on this
			// grayscale overlay than Chromium's and Firefox's so we tone it down with brightness()
			canvas.style.setProperty('filter', 'brightness(0.9)');
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
			// A failed compile otherwise renders nothing, silently, forever —
			// the canvas just stays transparent. Surface it so the e2e suite's
			// console-error net catches a broken shader, not only the blank-
			// canvas pixel assertion.
			if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
				console.error('HalftoneOverlay shader failed to compile:', gl.getShaderInfoLog(shader));
			}
			return shader;
		};
		const prog = gl.createProgram()!;
		gl.attachShader(prog, compile(gl.VERTEX_SHADER, vertSrc));
		gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fragSrc));
		gl.linkProgram(prog);
		if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
			console.error('HalftoneOverlay program failed to link:', gl.getProgramInfoLog(prog));
		}
		gl.useProgram(prog);

		const buf = gl.createBuffer()!;
		gl.bindBuffer(gl.ARRAY_BUFFER, buf);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
		const aPos = gl.getAttribLocation(prog, 'aPos');
		gl.enableVertexAttribArray(aPos);
		gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

		const uResolution = gl.getUniformLocation(prog, 'uResolution');
		const uCenter = gl.getUniformLocation(prog, 'uCenter');
		const uPattern = gl.getUniformLocation(prog, 'uPattern');
		const uAngle = gl.getUniformLocation(prog, 'uAngle');
		const uContrast = gl.getUniformLocation(prog, 'uContrast');
		const uCellSize = gl.getUniformLocation(prog, 'uCellSize');
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
			// uPattern/uAngle are read once per frame, so re-reading the props
			// here keeps a changed pattern live without a re-init.
			gl.uniform1i(uPattern, pattern === 'line' ? 1 : 0);
			gl.uniform1f(uAngle, (angle * Math.PI) / 180);
			gl.uniform1f(uContrast, contrast);
			gl.uniform1f(uCellSize, cellSize);
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
			// The overlay itself must not feed the capture it is drawn from, and
			// some foreground chrome intentionally sits above the effect rather
			// than being screened by it. In particular the CTA's SVG-filtered
			// pseudo-element is not reproduced accurately by html2canvas, so the
			// capture must skip any subtree marked as halftone-ignored.
			const captured = await html2canvas(document.body, {
				backgroundColor: null,
				scale: 1, // 1 canvas px = 1 CSS px so the rings line up exactly
				useCORS: true,
				logging: false,
				ignoreElements: (el) =>
					el === canvas || el.closest(HALFTONE_CAPTURE_IGNORE_SELECTOR) !== null
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
	clickable. -->
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
