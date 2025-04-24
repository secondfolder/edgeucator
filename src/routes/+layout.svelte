<script lang="ts">
	import { browser } from '$app/environment';
	import { setUserContext } from '$lib/contexts/user';
	import { pb } from '$lib/pocketbase';
	import { onDestroy, type Snippet } from 'svelte';
	import { writable } from 'svelte/store';
	import type { PageData } from './$types';
	import SiteHeader from '$lib/components/SiteHeader.svelte';

	interface Props {
		data: PageData;
		children?: Snippet;
	}

	let { data, children }: Props = $props();

    // Initialize user store
    const user = writable(data.user);
    setUserContext(user);

    if (browser) {
        // Load user from cookie (client-side only)
        pb.authStore.loadFromCookie(document.cookie);

        // Update user store when auth store changes
        const unsubscribe = pb.authStore.onChange(() => {
            user.set(pb.authStore.record);
            document.cookie = pb.authStore.exportToCookie({ httpOnly: false });
        }, true);
        onDestroy(unsubscribe);
    }
</script>


<SiteHeader />
{@render children?.()}

<style>
	:root {
		--wa-color-text-danger: var(--wa-color-red-40);
	}
</style>
