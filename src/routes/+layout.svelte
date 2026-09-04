<script lang="ts">
	import SiteHeader from '$lib/components/SiteHeader.svelte';
	import type { Snippet } from 'svelte';

	interface Props {
		children?: Snippet;
	}

	let { children }: Props = $props();

	// The user store/context and the PocketBase authStore cookie mirroring are
	// gone: Better Auth's cookies are httpOnly (which the old
	// `exportToCookie({ httpOnly: false })` was not), so there is nothing for
	// the client to read. Server load data is the single source of truth, read
	// via `page.data.user` wherever it is needed.
</script>

<SiteHeader />
{@render children?.()}

<style>
	:root {
		--wa-color-text-danger: var(--wa-color-red-40);
	}
</style>
