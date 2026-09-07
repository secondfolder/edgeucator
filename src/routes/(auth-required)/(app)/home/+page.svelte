<script lang="ts">
	import { resolve } from '$app/paths';
</script>

<div class="home">
	<header>
		<h1>Edgeucator</h1>
		<span class="subtitle">Your Edging Escort</span>
	</header>
	<wa-button variant="brand" size="large" href={resolve('/(auth-required)/(app)/home/guides')}
		>Guides</wa-button
	>
</div>

<style>
	.home {
		min-height: 100%;
		box-sizing: border-box;
		padding: 1rem;

		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;
		text-align: center;
		gap: 3rem;

		header {
			h1 {
				/* Smaller than the logged-out landing page's 5rem: this one shares
				   the viewport with the nav and has to survive a phone. */
				font-size: clamp(2.5rem, 12vw, 4rem);
				margin: 0;
			}

			.subtitle {
				font-size: clamp(1rem, 5vw, 1.5rem);
				color: var(--wa-color-text-secondary);
			}
		}
	}
</style>
