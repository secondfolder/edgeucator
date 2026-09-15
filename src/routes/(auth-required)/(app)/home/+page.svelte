<script lang="ts">
	import { resolve } from '$app/paths';
	import UnreadPartnerLinks from '$lib/components/UnreadPartnerLinks.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<div class="home">
	<header>
		<h1>Bound Up</h1>
		<span class="subtitle">Your Kink Companion</span>
	</header>
	<div class="quick-links">
		<wa-button variant="brand" size="l" href={resolve('/(auth-required)/(app)/home/guides')}
			>Guides</wa-button
		>
		<wa-button variant="brand" size="l" href={resolve('/(auth-required)/(app)/home/tasks')}
			><wa-icon slot="start" name="list-check" variant="solid"></wa-icon>Tasks</wa-button
		>
		<wa-button variant="brand" size="l" href={resolve('/(auth-required)/(app)/home/rewards')}
			><wa-icon slot="start" name="gift" variant="solid"></wa-icon>Rewards</wa-button
		>
	</div>
	<!-- Above the Guides button on purpose: something waiting from a partner is
	     the reason to have opened the app, and it should not be below the fold
	     on a short phone. Renders nothing when there is nothing waiting. -->
	<UnreadPartnerLinks unread={data.unread} />
</div>

<style>
	.home {
		min-height: 100%;
		box-sizing: border-box;
		padding: 1rem;

		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 2rem;

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
