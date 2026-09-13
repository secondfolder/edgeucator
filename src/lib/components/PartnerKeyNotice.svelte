<script lang="ts">
	import type { TrustView } from '$lib/crypto/trust.svelte';
	import SafetyNumber from './SafetyNumber.svelte';

	/**
	 * Everything this device has to say about the two keys in a partnership.
	 *
	 * One component for all six states rather than a callout per case in each
	 * page, because the board and the thread view both need the identical thing
	 * and a second copy would drift — and because the states are mutually
	 * exclusive, so which one shows is a single decision.
	 *
	 * The states, and why each reads the way it does:
	 *
	 * - `missing` — they have not set up messaging. Not a warning; there is
	 *   simply nobody to encrypt to yet.
	 * - `new` — first sight on this device. Sending is allowed, because that is
	 *   what trust-on-first-use means, but it says *when* it was first seen so
	 *   "a moment ago" is not mistaken for "two years ago". Pins are per-device
	 *   until `sealed_pins` exists, so a new phone lands here legitimately.
	 * - `pinned` — matches, never compared out of band. A quiet offer, not a nag.
	 * - `verified` — matches and was compared. A small, permanent reassurance.
	 * - `changed` (partner) — blocked. The one state that stops a send.
	 * - `changed` (own) — the server returned a different key for *you*.
	 */
	let {
		trust,
		partnerName,
		verify,
		accept
	}: {
		trust: TrustView;
		partnerName: string;
		verify: () => Promise<void>;
		accept: (which: 'partner' | 'own') => Promise<void>;
	} = $props();

	let showNumber = $state(false);
	let working = $state(false);

	async function run(action: () => Promise<void>) {
		working = true;
		try {
			await action();
		} finally {
			working = false;
		}
	}

	/** Absolute, not relative: "first seen 3 days ago" invites a shrug; a date is checkable. */
	function when(stamp: number): string {
		return new Intl.DateTimeFormat(undefined, {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(new Date(stamp));
	}
</script>

{#if trust.status === 'unavailable'}
	<wa-callout variant="neutral" size="small">
		<wa-icon slot="icon" name="triangle-exclamation" variant="solid"></wa-icon>
		This browser will not remember which keys it has seen, so it cannot warn you if
		{partnerName}'s key changes. Messages are still encrypted.
	</wa-callout>
{:else if trust.status === 'known'}
	{#if trust.own.kind === 'changed'}
		<!--
			Listed before the partner's, and worded differently, because it means
			something worse: the server returned a different public key for the
			user's own account than this device recorded. The innocent cause is a
			password reset, which replaces the identity — so that is named, since
			otherwise this reads as an accusation the user cannot act on.
		-->
		<wa-callout variant="danger">
			<wa-icon slot="icon" name="triangle-exclamation" variant="solid"></wa-icon>
			<strong>Your own message key has changed</strong>
			<p>
				This device recorded a different key for your account. That is expected if you reset your
				password — it replaces your keys. If you did not, do not send anything: someone may have
				changed them for you.
			</p>
			<!-- svelte-ignore a11y_click_events_have_key_events,a11y_no_static_element_interactions -->
			<wa-button
				size="s"
				variant="danger"
				disabled={working}
				onclick={() => run(() => accept('own'))}
			>
				I reset my password — use the new key
			</wa-button>
		</wa-callout>
	{:else if trust.partner.kind === 'changed'}
		<wa-callout variant="danger">
			<wa-icon slot="icon" name="triangle-exclamation" variant="solid"></wa-icon>
			<strong>{partnerName}'s message key has changed</strong>
			<p>
				This device first saw a different key on {when(trust.partner.pinned.pinnedAt)}. That happens
				when they reset their password — but it is also what it would look like if someone were
				trying to read your messages.
			</p>
			<!--
				Said explicitly because "key changed" otherwise reads as "your history
				is gone", which would make the safe action look expensive.
			-->
			<p>
				Everything they have already sent you stays readable — you decrypt that with your own key,
				not theirs. Only new messages are held back.
			</p>
			{#if trust.safetyNumber}
				<SafetyNumber value={trust.safetyNumber} {partnerName} tone="warning" />
			{/if}
			<!-- svelte-ignore a11y_click_events_have_key_events,a11y_no_static_element_interactions -->
			<wa-button
				size="s"
				variant="danger"
				disabled={working}
				onclick={() => run(() => accept('partner'))}
			>
				I checked with {partnerName} — this is their new key
			</wa-button>
		</wa-callout>
	{:else if trust.partner.kind === 'missing'}
		<wa-callout variant="neutral" size="small">
			{partnerName} hasn't set up encrypted messaging yet, so there is nobody to encrypt to. Nudge them.
		</wa-callout>
	{:else}
		<div class="quiet">
			{#if trust.partner.kind === 'verified'}
				<p class="line">
					<!-- circle-check, not shield-check: the latter is Font Awesome Pro, and a
					     missing icon fails silently as an empty box. -->
					<wa-icon name="circle-check" variant="solid"></wa-icon>
					You checked {partnerName}'s key on {when(trust.partner.verifiedAt)}.
				</p>
			{:else if trust.partner.kind === 'new'}
				<p class="line">
					<wa-icon name="circle-info" variant="solid"></wa-icon>
					This device is seeing {partnerName}'s key for the first time.
				</p>
			{/if}

			{#if trust.safetyNumber && trust.partner.kind !== 'verified'}
				{#if showNumber}
					<SafetyNumber value={trust.safetyNumber} {partnerName} />
					<div class="actions">
						<!-- svelte-ignore a11y_click_events_have_key_events,a11y_no_static_element_interactions -->
						<wa-button size="s" disabled={working} onclick={() => run(verify)}>
							It matches
						</wa-button>
						<!-- svelte-ignore a11y_click_events_have_key_events,a11y_no_static_element_interactions -->
						<wa-button size="s" appearance="plain" onclick={() => (showNumber = false)}>
							Not now
						</wa-button>
					</div>
				{:else}
					<!-- svelte-ignore a11y_click_events_have_key_events,a11y_no_static_element_interactions -->
					<wa-button size="s" appearance="plain" onclick={() => (showNumber = true)}>
						Check your safety number
					</wa-button>
				{/if}
			{/if}
		</div>
	{/if}
{/if}

<style>
	.quiet {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.375rem;
		font-size: 0.8125rem;
		color: var(--wa-color-text-quiet);

		.line {
			margin: 0;
			display: flex;
			align-items: center;
			gap: 0.375rem;
		}

		.actions {
			display: flex;
			gap: 0.5rem;
		}
	}

	wa-callout {
		display: block;

		strong {
			display: block;
		}

		p {
			margin: 0.25rem 0 0.5rem;
			font-size: 0.875rem;
		}
	}
</style>
