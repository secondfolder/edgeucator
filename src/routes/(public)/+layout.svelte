<script lang="ts">
	import { page } from '$app/state';
	import SiteHeader from '$lib/components/SiteHeader.svelte';

	let { children } = $props();

	// The landing page is chromeless on purpose: its centred CTA and the ring
	// overlay want the whole viewport, and the header's Login/Sign up links
	// duplicate what the CTA already does. Everything else in the group —
	// login, signup, invite — keeps the header. Route id, not pathname, per
	// the active-nav convention: ids are identical server- and client-side.
	// A group-only index route keeps the group in its id — '/(public)', not
	// '/' — verified against the generated $types.
	const isLanding = $derived(page.route.id === '/(public)');
</script>

<svelte:head>
	<style>
		body {
			display: flex;
			flex-direction: column;
			align-items: center;
			min-height: 100svh;
		}
	</style>
</svelte:head>
{#if !isLanding}<SiteHeader />{/if}
<div class="container">
	{@render children()}
</div>

<style>
	.container {
		--padding: 1em;
		max-width: calc(100svw - (var(--padding) * 1));
		width: 800px;
		padding: var(--padding);
		display: flex;
		flex-direction: column;
		flex: 1 1 auto;
	}
</style>
