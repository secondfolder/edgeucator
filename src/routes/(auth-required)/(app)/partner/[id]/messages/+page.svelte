<script lang="ts">
	import { invalidate } from '$app/navigation';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { currentKeyring, unlockWithPassword } from '$lib/crypto/session.svelte';
	import { acknowledgeWarning, sendMessage } from '$lib/messaging/client';
	import { DEFAULT_THREAD_ICON, type ThreadIcon } from '$lib/messaging';
	import { page } from '$app/state';
	import HistoryWarning from '$lib/components/HistoryWarning.svelte';
	import MessageComposer from '$lib/components/MessageComposer.svelte';
	import StickerBoard from '$lib/components/StickerBoard.svelte';
	import ThreadIconPicker from '$lib/components/ThreadIconPicker.svelte';
	import UnlockForm from '$lib/components/UnlockForm.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const user = $derived(page.data.user as { id: string; email: string });
	const keyring = $derived(currentKeyring());
	const acknowledged = $derived(data.historyWarningAcknowledged);

	let composing = $state(false);
	let icon: ThreadIcon = $state(DEFAULT_THREAD_ICON);

	const targets = $derived(
		[data.recipients.mine, data.recipients.theirs].filter(
			(value): value is string => value !== null
		)
	);

	/** Relative, because "3 days ago" is what matters on a board, not a clock. */
	function formatWhen(date: Date): string {
		const seconds = Math.round((Date.now() - date.getTime()) / 1000);
		if (seconds < 60) return 'just now';
		const minutes = Math.round(seconds / 60);
		if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
		const hours = Math.round(minutes / 60);
		if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
		const days = Math.round(hours / 24);
		if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
		return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
	}

	async function send(message: { text: string; files: File[] }): Promise<string | null> {
		const outcome = await sendMessage(
			{ kind: 'new-thread', partnershipId: data.partner.id, icon },
			message,
			targets
		);
		if (!outcome.ok) return outcome.message;

		composing = false;
		icon = DEFAULT_THREAD_ICON;
		await invalidate(`messages:board:${data.partner.id}`);
		// Straight into the thread that was just started, which is where the
		// reply will land.
		await goto(
			resolve('/(auth-required)/(app)/partner/[id]/messages/[threadId]', {
				id: data.partner.id,
				threadId: outcome.threadId
			})
		);
		return null;
	}

	async function acknowledge() {
		await acknowledgeWarning(data.partner.id);
		await invalidate(`messages:board:${data.partner.id}`);
	}
</script>

<svelte:head><title>{data.partner.name} — messages</title></svelte:head>

{#if keyring.status === 'absent'}
	<section class="notice">
		<h1>Set up encrypted messages</h1>
		<p>This account has no message keys yet, so there is nothing to encrypt with.</p>
		<wa-button variant="brand" href={resolve('/(auth-required)/(app)/settings/encryption')}>
			Set up messaging
		</wa-button>
	</section>
{:else if keyring.status === 'locked'}
	<section class="notice">
		<h1>Unlock your messages</h1>
		<p>
			They are encrypted on this device. This happens on a new phone, after signing in with a
			passkey, or when the browser has cleared its storage.
		</p>
		<UnlockForm
			unlock={(password) => unlockWithPassword(user, password).then(() => undefined)}
			wrongPassword={keyring.reason === 'wrong-password'}
		/>
	</section>
{:else if !acknowledged}
	<HistoryWarning {acknowledge} />
{:else}
	<section class="board">
		<header>
			<h1>{data.partner.name}</h1>
			{#if data.recipients.theirs === null}
				<wa-callout variant="neutral" size="small">
					{data.partner.name} hasn't set up encrypted messaging yet, so there is nobody to encrypt to.
					Nudge them.
				</wa-callout>
			{/if}
			{#each data.restoreRequests as request (request.id)}
				<wa-callout variant="warning" size="small">
					{#if request.mine}
						You asked {data.partner.name} to restore your history. They need to compare a safety number
						with you before they can.
					{:else}
						{data.partner.name} lost their key and is asking for your shared history back. Check the safety
						number with them first.
					{/if}
				</wa-callout>
			{/each}
		</header>

		<StickerBoard threads={data.threads} partnershipId={data.partner.id} {formatWhen} />

		{#if data.recipients.theirs !== null}
			<div class="new">
				{#if composing}
					<div class="composer">
						<ThreadIconPicker bind:value={icon} />
						<!--
							No autofocus. `<wa-textarea autofocus>` reaches for its inner
							textarea before the shadow root exists and throws "Cannot read
							properties of null (reading 'focus')" — an uncaught error during
							hydration, which stops Svelte wiring up the rest of the component
							and leaves the whole composer dead. Focusing the host by hand
							after `updateComplete` had the same effect. The composer appears
							on a tap, so the user is already looking at it.
						-->
						<MessageComposer {send} placeholder="What are you thinking?" submitLabel="Send it" />
						<wa-button appearance="plain" size="small" onclick={() => (composing = false)}>
							Cancel
						</wa-button>
					</div>
				{:else}
					<!-- "Write something" rather than "New message": /home already has
					     a "new messages from …" link, and two controls must not share an
					     accessible name. -->
					<wa-button variant="brand" size="large" onclick={() => (composing = true)}>
						Write something
					</wa-button>
				{/if}
			</div>
		{/if}
	</section>
{/if}

<style>
	.notice {
		max-width: 26rem;
		margin: 0 auto;
		padding: var(--wa-space-xl) var(--wa-space-l);
		display: flex;
		flex-direction: column;
		gap: var(--wa-space-m);

		h1 {
			margin: 0;
			font-size: 1.25rem;
		}

		p {
			margin: 0;
			color: var(--wa-color-text-quiet);
			font-size: 0.9375rem;
		}
	}

	.board {
		display: flex;
		flex-direction: column;
		/* flex rather than a percentage height: the shell only sets min-height on
		   the page wrapper, so there is no specified height to resolve against. */
		flex: 1 1 auto;
		min-block-size: 0;

		header {
			padding: var(--wa-space-m) var(--wa-space-m) 0;
			display: flex;
			flex-direction: column;
			gap: var(--wa-space-s);

			h1 {
				margin: 0;
				font-size: 1.25rem;
			}
		}
	}

	.new {
		/* Sticky INSIDE the scrolling <main>, which pins it above AppNav. Against
		   the viewport it would not work at all — see Task.svelte. */
		position: sticky;
		inset-block-end: 0;
		padding: var(--wa-space-s) var(--wa-space-m) var(--wa-space-m);
		display: flex;
		flex-direction: column;
		background: linear-gradient(
			to bottom,
			transparent,
			var(--wa-color-surface-default, white) 0.75rem
		);

		.composer {
			display: flex;
			flex-direction: column;
			gap: 0.75rem;
		}
	}
</style>
