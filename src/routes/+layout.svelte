<script lang="ts">
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
	//
	// SiteHeader used to live here. It now belongs to (public) only: the
	// (auth-required)/(app) group has its own shell with a bottom nav, and
	// stacking a second navigation on top of it defeats the point.
</script>

{@render children?.()}

<style>
	:root {
		--wa-color-text-danger: var(--wa-color-red-40);
	}
</style>
