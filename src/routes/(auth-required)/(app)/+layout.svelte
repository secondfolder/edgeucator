<script lang="ts">
	import { page } from '$app/state';
	import AppNav from '$lib/components/AppNav.svelte';
	import EncryptionGate from '$lib/components/EncryptionGate.svelte';
	import TimezoneWarning from '$lib/components/TimezoneWarning.svelte';
	import type { Snippet } from 'svelte';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	const showTimezoneWarning = $derived.by(() => {
		const routeId = page.route.id;
		if (!routeId) return false;

		return (
			routeId === '/(auth-required)/(app)/home' ||
			routeId.startsWith('/(auth-required)/(app)/partner/') ||
			routeId.startsWith('/(auth-required)/(app)/settings')
		);
	});
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
		{#if showTimezoneWarning}
			<TimezoneWarning user={data.user} />
		{/if}
		<!-- Inside <main> so it scrolls with the page: `position: fixed` against
		     the viewport does not work in this shell, and a callout pinned over
		     the content would cover it. -->
		<EncryptionGate
			user={data.user}
			userHasMessageHistory={data.userHasMessageHistory}
			handledByPage={(page.route.id?.includes('/partner/[id]/messages') ?? false) ||
				(page.route.id?.endsWith('/settings/encryption') ?? false)}
		/>
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
			/* Flex column so a page's `flex: 1 1 auto` root actually stretches to
		   fill the pane — without it the root is a plain block of content height,
		   and a short thread left the composer footer part-way up the screen
		   instead of pinned above AppNav. Every (app) page has a single root
		   element, which is what makes this safe. */
			display: flex;
			flex-direction: column;
			/* Momentum scrolling inside the pane, not rubber-banding of the page. */
			overscroll-behavior: contain;
		}
	}
</style>
