<script lang="ts">
	import { resolve } from '$app/paths';
</script>

<div class="landing">
	<header>
		<h1>Edgeucator</h1>
		<span class="subtitle">Your Edging Escort</span>
	</header>
	<a href={resolve('/(auth-required)/(app)/home/guides')}>Guides</a>
</div>

<style>
	.landing {
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;
		/* Fills the layout container rather than a hard 100svh: the site header
		   sits above it, so 100svh would push the page into a scroll. */
		flex: 1 1 auto;

		text-align: center;
		gap: 4em;

		header {
			h1 {
				/* Was a flat 5rem, which ran off both edges of a phone. The vw
				   term keeps the desktop size and shrinks it to fit below that. */
				font-size: clamp(2.5rem, 16vw, 5rem);
				margin: 0;
			}
			.subtitle {
				font-size: clamp(1.25rem, 6vw, 2rem);
				color: var(--wa-color-text-secondary);
			}
		}
	}
</style>
