<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import { currentTimeZoneOrUtc, timezoneBannerStorageKey } from '$lib/timezone';

	let {
		user = null
	}: {
		user?: { id: string; timezone: string } | null;
	} = $props();

	let deviceTimezone = $state('UTC');
	let dismissed = $state(false);
	// False until refresh() has actually read the device timezone and the
	// dismissal state. Rendering before that shows the banner to anyone whose
	// account timezone differs from the SSR default ('UTC') for the first paint
	// — a flash that disappears once onMount runs. Default to hidden and only
	// reveal once we know it is warranted.
	let checked = $state(false);
	let busy = $state(false);
	let problem = $state<string | null>(null);
	let lastUserId: string | null = null;

	onMount(() => {
		refresh();
	});

	$effect(() => {
		if (user?.id !== lastUserId) refresh();
	});

	const visible = $derived(
		checked && Boolean(user && user.timezone !== deviceTimezone && !dismissed)
	);

	function refresh() {
		lastUserId = user?.id ?? null;
		deviceTimezone = currentTimeZoneOrUtc();
		problem = null;
		dismissed = user
			? window.localStorage.getItem(timezoneBannerStorageKey(user.id)) === deviceTimezone
			: false;
		checked = true;
	}

	function dismiss() {
		if (!user) return;
		window.localStorage.setItem(timezoneBannerStorageKey(user.id), deviceTimezone);
		dismissed = true;
	}

	async function useDeviceTimezone() {
		if (!user) return;

		busy = true;
		problem = null;
		const form = new FormData();
		form.set('timezone', deviceTimezone);

		try {
			const response = await fetch('/api/account/timezone', {
				method: 'POST',
				body: form
			});
			const result = (await response.json().catch(() => null)) as {
				ok?: boolean;
				error?: string;
			} | null;

			if (!response.ok || !result?.ok) {
				problem = result?.error ?? 'Could not update your timezone';
				return;
			}

			window.localStorage.removeItem(timezoneBannerStorageKey(user.id));
			dismissed = false;
			await invalidateAll();
		} catch (caught) {
			console.error(caught);
			problem = 'Could not update your timezone';
		} finally {
			busy = false;
		}
	}
</script>

{#if visible && user}
	<wa-callout variant="neutral" class="warning">
		<wa-icon slot="icon" name="clock" variant="solid"></wa-icon>
		<strong>This device is in a different timezone</strong>
		<p>Your account is set to {user.timezone}, but this device is set to {deviceTimezone}.</p>
		<div class="actions">
			<!-- svelte-ignore a11y_click_events_have_key_events,a11y_no_static_element_interactions -->
			<wa-button type="button" size="s" variant="brand" onclick={useDeviceTimezone} disabled={busy}
				>Use {deviceTimezone}</wa-button
			>
			<!-- svelte-ignore a11y_click_events_have_key_events,a11y_no_static_element_interactions -->
			<wa-button type="button" size="s" appearance="plain" onclick={dismiss} disabled={busy}
				>Dismiss</wa-button
			>
		</div>
		{#if problem}<span class="invalid">{problem}</span>{/if}
	</wa-callout>
{/if}

<style>
	.warning {
		display: block;
		margin: var(--wa-space-m);

		strong {
			display: block;
		}

		p {
			margin: 0.25rem 0 0.75rem;
			color: var(--wa-color-text-quiet);
			font-size: 0.875rem;
		}

		.actions {
			display: flex;
			gap: 0.5rem;
			flex-wrap: wrap;
		}

		.invalid {
			display: block;
			margin-top: 0.75rem;
			color: var(--wa-color-text-danger);
		}
	}
</style>
