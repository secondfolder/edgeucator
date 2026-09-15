<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import HalftoneOverlay from '$lib/components/HalftoneOverlay.svelte';

	// The root layout whitelists this — `locals.user` itself never crosses.
	const user = $derived(page.data.user);
	let ctaBlurStdDeviation = $state('0.45');
	let ctaWobbleBaseFrequency = $state('0.0200');
	let ctaWobbleScale = $state('40.00');
	let ctaGrainScale = $state('6.00');

	onMount(() => {
		const prefersReducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
		const userAgent = navigator.userAgent;
		const isSafari =
			navigator.vendor === 'Apple Computer, Inc.' &&
			!/CriOS|FxiOS|EdgiOS|Chrome|Chromium|Android/.test(userAgent);
		if (isSafari) {
			console.log('Safari detected, adjusting CTA blur.');
			// Safari rasterizes this already-displaced SVG edge softer than
			// Chromium/Firefox, so the same post-displacement blur reads as fuzz.
			// Lower its cleanup blur there instead of changing the whole filter.
			ctaBlurStdDeviation = '0';
		}

		if (prefersReducedMotion) {
			return;
		}

		let animationFrame = 0;
		const start = performance.now();
		const tick = (now: number) => {
			const seconds = (now - start) / 1000;
			// Two slow waves keep the outline drifting rather than pulsing on one
			// obvious beat, which reads more like a hand-cut edge breathing.
			ctaWobbleBaseFrequency = (0.02 + Math.sin(seconds * 0.55) * 0.003).toFixed(4);
			ctaWobbleScale = (
				38 +
				Math.sin(seconds * 0.8) * 4 +
				Math.sin(seconds * 0.31 + 1.2) * 2
			).toFixed(2);
			ctaGrainScale = (6 + Math.sin(seconds * 1.05 + 0.4) * 1.1).toFixed(2);
			animationFrame = requestAnimationFrame(tick);
		};

		animationFrame = requestAnimationFrame(tick);

		return () => {
			cancelAnimationFrame(animationFrame);
		};
	});
</script>

<svelte:head>
	<!-- Page-scoped body rule, in the layout's idiom: each shell sets the body
	     rules it needs through svelte:head so they mount and unmount with it.
	     On both body and html — the html one is what paints the overscroll
	     area, and without it dragging past the top reveals the default white. -->
	<style>
		html,
		body {
			background: linear-gradient(to right, #943700 10%, #711500 100%);
		}
	</style>
</svelte:head>

<HalftoneOverlay
	pattern="line"
	angle={15}
	contrast={0.4}
	cellSize={6}
	noiseStrength={1.3}
	speed={0}
/>

<!-- The raggedy edge on the big CTA, in two passes — one feTurbulence can
     only be coarse-or-fine, never both:
     1. low baseFrequency (long wavelength) + large scale: the outline
        meanders in and out, the hand-cut silhouette;
     2. high baseFrequency (tight wavelength) + small scale: the gritty
        chewed-up texture along that outline, like the Muddy Tractor glyphs.
     The second pass displaces the *result* of the first (its `in` is the
     first map's output), so the effects add rather than fight. Inline SVG
     defs rather than a filter file so it ships with the page and stays
     tweakable here; aria-hidden + 0×0 because only the CSS
     `filter: url(#…)` reference on .big ever points at it. -->
<svg width="0" height="0" aria-hidden="true" focusable="false">
	<defs>
		<filter id="ragged-edge" x="-10%" y="-10%" width="120%" height="120%">
			<feTurbulence
				type="fractalNoise"
				baseFrequency={ctaWobbleBaseFrequency}
				numOctaves="2"
				seed="61"
				result="wobbleNoise"
			/>
			<!-- Explicit R/G channel selectors: feDisplacementMap defaults to the
			     alpha channel, and turbulence alpha is flat 1. Using red + green
			     is what actually turns the noise field into x/y motion. -->
			<feDisplacementMap
				in="SourceGraphic"
				in2="wobbleNoise"
				xChannelSelector="R"
				yChannelSelector="G"
				scale={ctaWobbleScale}
				result="wobbled"
			/>
			<feTurbulence
				type="fractalNoise"
				baseFrequency="0.1"
				numOctaves="3"
				seed="3"
				result="grainNoise"
			/>
			<feDisplacementMap
				in="wobbled"
				in2="grainNoise"
				xChannelSelector="R"
				yChannelSelector="G"
				scale={ctaGrainScale}
				result="ragged"
			/>
			<!-- The displacement gives the outline the right torn shape, but it
			     quantises the edge onto hard pixel steps. A tiny blur after both
			     passes acts like antialiasing: it softens the stair-steps without
			     melting the overall silhouette back into a smooth pill. -->
			<feGaussianBlur in="ragged" stdDeviation={ctaBlurStdDeviation} />
		</filter>
	</defs>
</svg>

<div class="landing">
	<header>
		<h1>Bound Up</h1>
		<span class="subtitle">Your Kink Companion</span>
	</header>

	<!-- Dead centre, above the overlay: the rings radiate from the centre of
		     the captured document, and this stack is placed at 50%/50% of the
		     same initial containing block so the button sits on the rings' origin.
		     z-index 10000 beats the overlay canvas's 9999 — everything else on
		     the page stays under the effect, this one element floats on it.
		     It is also excluded from the halftone capture: html2canvas sees the
		     undeformed ::before pill more faithfully than the live SVG-filtered
		     edge, which made the overlay pick up a faint static outline. -->
	<div class="cta" data-halftone-ignore="true">
		{#if user}
			<a class="big" href={resolve('/(auth-required)/(app)/home')}><span>Start</span></a>
		{:else}
			<!-- aria-labels keep the accessible names distinct from the site
			     header's "Login"/"Sign up" — two links sharing a name is both an
			     a11y problem and an ambiguous test locator. -->
			<a class="big" href={resolve('/(public)/signup')} aria-label="Sign up for Bound Up">
				<span>Sign up</span>
			</a>
			<a class="small" href={resolve('/(public)/login')}>Log in</a>
		{/if}
	</div>
</div>

<style>
	@font-face {
		font-family: 'Muddy Tractor';
		src: url('/fonts/muddy-tractor.woff2') format('woff2');
		font-display: swap;
	}

	.landing {
		/* Transparent: the wash behind the halftone overlay lives on the body
		   (see the svelte:head style) so it fills the whole page, header
		   included, not just this column. */
		display: flex;
		flex-direction: column;
		/* Header toward the top rather than centred: the centre of the page
		   belongs to the CTA, which sits on the rings' origin point. */
		justify-content: flex-start;
		padding-block-start: 6vh;
		/* Fills the layout container, which is already viewport-tall from the
		   (public) body rule. A hard 100svh here would add the header block
		   back in and push the page into a scroll on pages that have one. */
		flex: 1 1 auto;

		text-align: center;

		header {
			h1 {
				/* Was a flat 5rem, which ran off both edges of a phone. The vw
				   term keeps the desktop size and shrinks it to fit below that. */
				font-family: 'Muddy Tractor', var(--wa-font-family-body);
				font-size: clamp(2.5rem, 10vw, 5rem);
				margin: 0;
				color: #ffac00;
			}
			.subtitle {
				font-size: clamp(1.25rem, 6vw, 2rem);
				/* Not --wa-color-text-secondary: that token is the light-theme
				   near-black, which is illegible on the dark rust wash and makes
				   the halftone overlay look like it skips the subtitle — black
				   ink over near-black text is imperceptible, so the subtitle
				   reads as floating above the effect. A light tint from the h1's
				   family instead. */
				color: #ffac00;
				line-height: 1.1;
			}
		}
	}

	.cta {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		z-index: 10000;
		/* The button, not the whole logged-out stack, owns the page centre.
		   The small login link sits visually under it but is taken out of flow,
		   otherwise it makes the centred flex column taller and pushes the sign
		   up button upward off the rings' origin. */
		display: flex;
		justify-content: center;
		align-items: center;
	}

	/* Short viewports: dead-centring the CTA puts it on top of the title, so
	   give the centre back and let the stack flow under the header instead.
	   The rings' origin is still the page centre — the CTA just no longer
	   claims it. */
	@media (max-height: 30em) {
		.cta {
			position: static;
			transform: none;
			margin-block-start: 2.5em;
		}

		.small {
			position: static;
			transform: none;
			margin-block-start: 0.75rem;
		}
	}

	.big {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.1em 0.8em 0.2em;
		/* Separate the text from the distorted shape: the second turbulence pass
		   is supposed to chew the outline, and when the filter lived on the
		   anchor it mostly showed up as wobble in the glyphs and shadow instead.
		   The decorative ::before pill now carries the filter; the label stays
		   crisp and all of the displacement budget is spent on the silhouette. */
		isolation: isolate;
		color: #ffac00;
		text-shadow: 0 6px 24px rgba(0, 0, 0, 0.55);
		font-family: var(--wa-font-family-body);
		font-size: clamp(1.5rem, 20vw, 4em);
		font-weight: 700;
		text-decoration: none;

		&::before {
			content: '';
			position: absolute;
			inset: 0;
			z-index: -1;
			border-radius: 999px;
			border: #ffac00 2px solid;
			background: #ffac004d;
			box-shadow: 0 6px 24px rgb(0 0 0 / 0.35);
			filter: url('#ragged-edge');
		}

		span {
			position: relative;
			z-index: 1;
			transition: scale 0.1s ease;

			&:hover {
				scale: 1.03;
			}
		}

		&:focus-visible {
			outline: 2px solid #ffcf7a;
			outline-offset: 3px;
		}
	}

	.small {
		position: absolute;
		top: calc(100% + 0.75rem);
		left: 50%;
		transform: translateX(-50%);
		color: #ffcf7a;
		text-decoration: underline;
		font-size: 1rem;
		white-space: nowrap;
		margin-top: 1em;
		font-weight: bold;
		font-size: 1.2em;
		transition: color 0.1s ease;

		&:hover {
			color: #ffac00;
		}

		&:focus-visible {
			outline: 2px solid #ffcf7a;
			outline-offset: 3px;
		}
	}
</style>
