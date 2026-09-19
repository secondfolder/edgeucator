<script lang="ts">
	import { invalidate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { currentKeyring, unlockWithPassword } from '$lib/crypto/session.svelte';
	import {
		acceptKeyChange,
		markVerified,
		refreshTrust,
		trustAllowsSending,
		trustFor
	} from '$lib/crypto/trust.svelte';
	import { watchPartnership } from '$lib/messaging/live';
	import NestedPageHeader from '$lib/components/NestedPageHeader.svelte';
	import PartnerKeyNotice from '$lib/components/PartnerKeyNotice.svelte';
	import ThreadView from '$lib/components/ThreadView.svelte';
	import UnlockForm from '$lib/components/UnlockForm.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const user = $derived(page.data.user as { id: string; email: string });
	const keyring = $derived(currentKeyring());

	/**
	 * The same key check as the board, because a reply is a send too.
	 *
	 * Both screens go through `trust.svelte.ts`, so accepting a key change here
	 * is immediately true on the board and the other way round — the alternative
	 * was a second copy of the state that could disagree with the first.
	 */
	const trust = $derived(trustFor(data.partner.id));
	const canSend = $derived(trustAllowsSending(trust));

	$effect(() => {
		if (keyring.status !== 'unlocked') return;
		void refreshTrust(user.id, data.partner.id, data.recipients);
	});

	/**
	 * Live updates for this thread.
	 *
	 * Subscribed per partnership rather than per thread, because that is what a
	 * Durable Object room is keyed on — one object per partnership, not per
	 * thread. Events for a *different* thread are therefore delivered here too,
	 * and ignored: invalidating this thread's key on someone else's reply would
	 * be a wasted load on every message the couple sends.
	 *
	 * Both ids go through `$derived` strings so the effect does not depend on
	 * the `data` prop, which `invalidate()` reassigns — see the longer note on
	 * the board, and the assertion in `e2e/messaging.spec.ts` that counts
	 * `EventSource` constructions.
	 */
	const partnershipId = $derived(data.partner.id);
	const threadId = $derived(data.thread.id);
	$effect(() => {
		const partnership = partnershipId;
		const thread = threadId;
		return watchPartnership({
			partnershipId: partnership,
			onChange: (event) => {
				if (event && event.threadId && event.threadId !== thread) return;
				void invalidate(`messages:thread:${thread}`);
			}
		});
	});
	const backHref = $derived(
		resolve('/(auth-required)/(app)/partner/[id]/messages', { id: data.partner.id })
	);
</script>

<svelte:head><title>{data.partner.name} — message</title></svelte:head>

<div class="page">
	<NestedPageHeader {backHref} backLabel="Back to messages" backText={data.partner.name} />

	{#if keyring.status === 'unlocked'}
		{#if !canSend}
			<!-- Above the messages, not below: it explains why there is no reply box
			     at the bottom, so it has to be seen before the reader gets there. -->
			<div class="trust">
				<PartnerKeyNotice
					{trust}
					partnerName={data.partner.name}
					verify={() => markVerified(user.id, data.partner.id, data.recipients)}
					accept={(which) => acceptKeyChange(user.id, data.partner.id, data.recipients, which)}
				/>
			</div>
		{/if}
		<ThreadView
			thread={data.thread}
			partnershipId={data.partner.id}
			tags={data.tags}
			recipients={data.recipients}
			userId={user.id}
			embedAutoLoad={data.embedAutoLoad}
			{canSend}
		/>
	{:else if keyring.status === 'locked'}
		<div class="locked">
			<p>These messages are locked on this device.</p>
			<UnlockForm
				unlock={(password) => unlockWithPassword(user, password).then(() => undefined)}
				wrongPassword={keyring.reason === 'wrong-password'}
			/>
		</div>
	{:else}
		<ThreadView
			thread={data.thread}
			partnershipId={data.partner.id}
			tags={data.tags}
			recipients={data.recipients}
			userId={user.id}
			embedAutoLoad={data.embedAutoLoad}
			{canSend}
		/>
	{/if}
</div>

<style>
	.page {
		display: flex;
		flex-direction: column;
		flex: 1 1 auto;
		min-block-size: 0;
	}

	.trust {
		padding: var(--wa-space-s) var(--wa-space-m) 0;
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
