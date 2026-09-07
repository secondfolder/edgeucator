<script lang="ts">
	import AppNav from '$lib/components/AppNav.svelte';
	import EncryptionGate from '$lib/components/EncryptionGate.svelte';
	import type { Snippet } from 'svelte';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();
</script>

<svelte:head>
	<style>
		/* The app shell owns the viewport: only <main> scrolls, so the nav stays
		   put instead of scrolling away like a document footer. Scoped to this
		   layout — Svelte removes it again on the way out to a (public) route. */
		body {
			margin: 0;
			overflow: hidden;
		}
	</style>
</svelte:head>

<div class="shell">
	<main>
		<!-- Inside <main> so it scrolls with the page: `position: fixed` against
		     the viewport does not work in this shell, and a callout pinned over
		     the content would cover it. -->
		<EncryptionGate />
		{@render children()}
	</main>
	<AppNav partners={data.partners} />
</div>

<style>
	.shell {
		height: 100svh;
		display: flex;
		flex-direction: column;

		main {
			flex: 1 1 auto;
			min-height: 0;
			overflow-y: auto;
			/* Momentum scrolling inside the pane, not rubber-banding of the page. */
			overscroll-behavior: contain;
		}
	}
</style>
