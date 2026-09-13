<script lang="ts">
	import { goto, invalidate } from '$app/navigation';
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
	import { page } from '$app/state';
	import HistoryWarning from '$lib/components/HistoryWarning.svelte';
	import NewMessageDialog from '$lib/components/NewMessageDialog.svelte';
	import NestedPageHeader from '$lib/components/NestedPageHeader.svelte';
	import PartnerKeyNotice from '$lib/components/PartnerKeyNotice.svelte';
	import RestoreRequests from '$lib/components/RestoreRequests.svelte';
	import StickerBoard from '$lib/components/StickerBoard.svelte';
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

	const targets = $derived(
		[data.recipients.mine, data.recipients.theirs].filter(
			(value): value is string => value !== null
		)
	);

	async function send(
		message: { text: string; files: File[] },
		tagIds: string[] = []
	): Promise<string | null> {
		const outcome = await sendMessage(
			{ kind: 'new-thread', partnershipId: data.partner.id, tagIds },
			message,
			targets
		);
		if (!outcome.ok) return outcome.message;

		composing = false;
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

			<StickerBoard threads={data.threads} partnershipId={data.partner.id} />

			{#if data.recipients.theirs !== null && canSend}
				<div class="new">
					<!-- "Write something" rather than "New message": /home already has
					     a "new messages from …" link, and two controls must not share an
					     accessible name. -->
					<!-- svelte-ignore a11y_click_events_have_key_events,a11y_no_static_element_interactions -->
					<wa-button
						variant="brand"
						appearance="filled"
						size="xl"
						pill
						class="fab"
						aria-label="Write something"
						onclick={() => (composing = true)}
					>
						<wa-icon name="paper-plane" variant="solid" label="Write something"></wa-icon>
					</wa-button>
				</div>
			{/if}

			{#if data.recipients.theirs !== null && canSend && composing}
				<NewMessageDialog
					partnerName={data.partner.name}
					partnershipId={data.partner.id}
					tags={data.tags}
					{send}
					close={() => (composing = false)}
				/>
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

	wa-button.fab::part(button) {
		display: grid;
		place-items: center;
		inline-size: 3.75rem;
		block-size: 3.75rem;
		padding: 0;
		border-radius: 999px;
		box-shadow: 0 0.8rem 1.6rem rgb(0 0 0 / 18%);
	}

	wa-button.fab::part(label) {
		display: grid;
		place-items: center;
		inline-size: 100%;
		block-size: 100%;
		/* Visually center icon */
		margin-left: -0.1em;
		margin-bottom: -0.1em;

		wa-icon {
			display: block;
			line-height: 1;
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
		position: sticky;
		inset-block-end: 0;
		z-index: 1;
		margin-block-start: auto;
		display: flex;
		justify-content: flex-end;
		padding: var(--wa-space-s) var(--wa-space-m) var(--wa-space-m);
		background: linear-gradient(
			to bottom,
			transparent,
			var(--wa-color-surface-default, white) 0.75rem
		);
		pointer-events: none;

		wa-button {
			pointer-events: auto;
		}
	}
</style>
