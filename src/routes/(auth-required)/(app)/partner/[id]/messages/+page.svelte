<script lang="ts">
	import { invalidate } from '$app/navigation';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { currentKeyring, unlockWithPassword } from '$lib/crypto/session.svelte';
	import {
		acceptKeyChange,
		markVerified,
		refreshTrust,
		trustAllowsSending,
		trustFor
	} from '$lib/crypto/trust.svelte';
	import { acknowledgeWarning, sendMessage } from '$lib/messaging/client';
	import { watchPartnership } from '$lib/messaging/live';
	import { DEFAULT_THREAD_ICON, type ThreadIcon } from '$lib/messaging';
	import { page } from '$app/state';
	import HistoryWarning from '$lib/components/HistoryWarning.svelte';
	import MessageComposer from '$lib/components/MessageComposer.svelte';
	import NestedPageHeader from '$lib/components/NestedPageHeader.svelte';
	import PartnerKeyNotice from '$lib/components/PartnerKeyNotice.svelte';
	import RestoreRequests from '$lib/components/RestoreRequests.svelte';
	import StickerBoard from '$lib/components/StickerBoard.svelte';
	import ThreadIconPicker from '$lib/components/ThreadIconPicker.svelte';
	import UnlockForm from '$lib/components/UnlockForm.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const user = $derived(page.data.user as { id: string; email: string });
	const keyring = $derived(currentKeyring());
	const acknowledged = $derived(data.historyWarningAcknowledged);

	const trust = $derived(trustFor(data.partner.id));
	const canSend = $derived(trustAllowsSending(trust));

	/**
	 * Checks the served keys against what this device pinned, and pins on first
	 * sight. Runs on every load rather than once: `recipients` changes when
	 * either partner resets their password, which is exactly the case that must
	 * not be missed.
	 *
	 * Gated on being unlocked only because there is nothing to send while
	 * locked, so a warning about what to send to would be noise.
	 */
	$effect(() => {
		if (keyring.status !== 'unlocked') return;
		void refreshTrust(user.id, data.partner.id, data.recipients);
	});

	/**
	 * The live feed, for as long as this board is on screen.
	 *
	 * The callback is a plain `invalidate` of this board's own key, so an event
	 * re-runs the load through the same authorised path as a navigation — the
	 * event itself carries no content and is not trusted for anything beyond
	 * "something changed". It is also called speculatively on reconnect, which
	 * is why it has to be idempotent.
	 *
	 * The effect depends on `partnershipId`, a `$derived` of a **string**, and
	 * not on `data` — that detail is the difference between one long-lived
	 * stream and one per message. `invalidate()` reassigns the `data` prop, so
	 * an effect that read `data.partner.id` directly re-ran on every arriving
	 * event and tore the connection down to open a new one. It still worked,
	 * which is why nothing else noticed; on Workers each of those reconnects is
	 * a fresh billed request to the Durable Object. A derived primitive stops
	 * propagating when its value is unchanged, so the effect stays put.
	 * `e2e/messaging.spec.ts` counts `EventSource` constructions to hold this.
	 */
	const partnershipId = $derived(data.partner.id);
	$effect(() => {
		const id = partnershipId;
		return watchPartnership({
			partnershipId: id,
			onChange: () => void invalidate(`messages:board:${id}`)
		});
	});
	const backHref = $derived(
		resolve('/(auth-required)/(app)/partner/[id]', { id: data.partner.id })
	);

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
	<section class="page">
		<NestedPageHeader
			{backHref}
			backLabel="Back to partner"
			backText={data.partner.name}
			title="Messages"
			iconName="envelope"
		/>

		<div class="board">
			<header>
				<!--
				The "they have not set up messaging" case lives in here too, rather
				than beside it: `pinStateFor` already calls that `missing`, and two
				components deciding when to mention the partner's key would drift.
			-->
				<PartnerKeyNotice
					{trust}
					partnerName={data.partner.name}
					verify={() => markVerified(user.id, data.partner.id, data.recipients)}
					accept={(which) => acceptKeyChange(user.id, data.partner.id, data.recipients, which)}
				/>
				<!--
				`mine`, not the trust view's safety number: a restore's number must be
				derived from the recipient snapshotted on the request, which is the
				value the re-encryption actually seals to. See the comment in
				RestoreRequests.svelte — using the served key here would defeat the
				out-of-band check entirely.
			-->
				<RestoreRequests
					requests={data.restoreRequests}
					partnershipId={data.partner.id}
					partnerName={data.partner.name}
					mine={data.recipients.mine}
				/>
			</header>

			<StickerBoard threads={data.threads} partnershipId={data.partner.id} {formatWhen} />

			{#if data.recipients.theirs !== null && canSend}
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
							<!-- svelte-ignore a11y_click_events_have_key_events,a11y_no_static_element_interactions -->
							<wa-button appearance="plain" size="small" onclick={() => (composing = false)}>
								Cancel
							</wa-button>
						</div>
					{:else}
						<!-- "Write something" rather than "New message": /home already has
					     a "new messages from …" link, and two controls must not share an
					     accessible name. -->
						<!-- svelte-ignore a11y_click_events_have_key_events,a11y_no_static_element_interactions -->
						<wa-button variant="brand" size="large" onclick={() => (composing = true)}>
							Write something
						</wa-button>
					{/if}
				</div>
			{/if}
		</div>
	</section>
{/if}

<style>
	.page {
		display: flex;
		flex-direction: column;
		flex: 1 1 auto;
		min-block-size: 0;
	}

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
			padding: 0 var(--wa-space-m);
			display: flex;
			flex-direction: column;
			gap: var(--wa-space-s);
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
