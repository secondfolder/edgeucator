<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { currentKeyring, unlockWithPassword } from '$lib/crypto/session.svelte';
	import ThreadView from '$lib/components/ThreadView.svelte';
	import UnlockForm from '$lib/components/UnlockForm.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const user = $derived(page.data.user as { id: string; email: string });
	const keyring = $derived(currentKeyring());
	const backHref = $derived(
		resolve('/(auth-required)/(app)/partner/[id]/messages', { id: data.partner.id })
	);
</script>

<svelte:head><title>{data.partner.name} — message</title></svelte:head>

<div class="page">
	<header>
		<!-- "Back to messages", not "Messages": the partner page's own button is
		     already called that, and two links must not share a name. -->
		<a href={backHref} aria-label="Back to messages">
			<wa-icon name="chevron-left" variant="solid"></wa-icon>
			<span>{data.partner.name}</span>
		</a>
		<wa-icon name={data.thread.icon} variant="solid"></wa-icon>
	</header>

	{#if keyring.status === 'unlocked'}
		<ThreadView thread={data.thread} partnershipId={data.partner.id} recipients={data.recipients} />
	{:else if keyring.status === 'locked'}
		<div class="locked">
			<p>These messages are locked on this device.</p>
			<UnlockForm
				unlock={(password) => unlockWithPassword(user, password).then(() => undefined)}
				wrongPassword={keyring.reason === 'wrong-password'}
			/>
		</div>
	{:else}
		<div class="locked"><p>Working out your keys…</p></div>
	{/if}
</div>

<style>
	.page {
		display: flex;
		flex-direction: column;
		flex: 1 1 auto;
		min-block-size: 0;

		header {
			display: flex;
			align-items: center;
			gap: 0.5rem;
			padding: var(--wa-space-s) var(--wa-space-m);
			border-block-end: 1px solid var(--wa-color-surface-border);

			a {
				display: flex;
				align-items: center;
				gap: 0.25rem;
				text-decoration: none;
				color: inherit;
				font-weight: var(--wa-font-weight-semibold, 600);
			}

			> wa-icon {
				margin-inline-start: auto;
				color: var(--wa-color-text-quiet);
			}
		}
	}

	.locked {
		max-width: 26rem;
		margin: 0 auto;
		padding: var(--wa-space-xl) var(--wa-space-l);
		display: flex;
		flex-direction: column;
		gap: var(--wa-space-m);

		p {
			margin: 0;
			color: var(--wa-color-text-quiet);
		}
	}
</style>
