<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { saveEmbedAutoLoadPreference } from '$lib/messaging/client';
	import {
		clearLocalEmbedAutoLoadPreference,
		writeLocalEmbedAutoLoadPreference
	} from '$lib/embed-autoload';
	import NestedPageHeader from '$lib/components/NestedPageHeader.svelte';
	import { superForm } from 'sveltekit-superforms';
	import PasswordField from '$lib/components/PasswordField.svelte';
	import { MIN_PASSWORD_LENGTH, scorePassword } from '$lib/password-strength';
	import { buildIdentitySubmission } from '$lib/crypto/setup';
	import {
		currentKeyring,
		initialiseKeyring,
		lock,
		unlockWithPassword
	} from '$lib/crypto/session.svelte';
	import UnlockForm from '$lib/components/UnlockForm.svelte';
	import { stashUnlock } from '$lib/crypto/stash';
	import {
		deriveMasterKey,
		deriveWrapKey,
		webCryptoAvailable,
		WEBCRYPTO_UNAVAILABLE
	} from '$lib/crypto/kdf';
	import { MASTER_KEY_VERSIONS } from '$lib/encryption';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const backHref = resolve('/(auth-required)/(app)/settings');

	const user = $derived(page.data.user as { id: string; email: string });
	const keyring = $derived(currentKeyring());
	const wraps = $derived(data.bundle.wraps);

	let generated: { phrase: string; entropyBits: number } | null = $state(null);
	let generating = $state(false);
	// svelte-ignore state_referenced_locally
	// Captures the load's initial preference on purpose so a local toggle can
	// update immediately without waiting for an invalidate round-trip.
	let embedAutoLoad = $state<boolean | null>(data.embedAutoLoad);
	let embedAutoLoadBusy = $state(false);
	let embedAutoLoadProblem = $state<string | null>(null);
	const embedAutoLoadChoice = $derived.by(() => {
		if (embedAutoLoad === true) return 'auto';
		if (embedAutoLoad === false) return 'manual';
		return '';
	});

	/**
	 * "The client has taken over", the same marker the account and security
	 * pages expose — and this select needs it more than they do.
	 *
	 * A change picked before hydration is lost twice over: nothing is listening
	 * yet, and hydration then writes the loaded preference back over the
	 * viewer's pick, so the control silently returns to the old value. There is
	 * no server action to fall back to either, because saving this is a fetch.
	 * `data-ready` is what e2e waits for rather than racing that window.
	 */
	let embedAutoLoadReady = $state(false);
	onMount(() => {
		embedAutoLoadReady = true;
	});

	/** The wordlist is ~68 KB, so it is only fetched if someone asks for one. */
	async function generatePhrase() {
		generating = true;
		try {
			const { generatePassphrase } = await import('$lib/passphrase/generate');
			const result = generatePassphrase();
			generated = { phrase: result.phrase, entropyBits: result.entropyBits };
		} finally {
			generating = false;
		}
	}

	let setupPassword = $state('');
	let setupConfirm = $state('');
	let setupError: string[] | undefined = $state(undefined);
	let setupConfirmError: string[] | undefined = $state(undefined);
	let acknowledged = $state(false);

	// svelte-ignore state_referenced_locally
	// Captures the load's initial `data.setupForm` on purpose: `superForm`
	// registers its lifecycle once, and re-running it on every `invalidate()`
	// would reset the form.
	const setupForm = superForm(data.setupForm, {
		id: 'setup',
		async onSubmit({ formData, cancel }) {
			setupError = undefined;
			setupConfirmError = undefined;

			if (!webCryptoAvailable()) {
				cancel();
				setupError = [WEBCRYPTO_UNAVAILABLE];
				return;
			}

			if (!data.hasPassword) {
				const strength = scorePassword(setupPassword);
				if (!strength.acceptable) {
					cancel();
					setupError = [strength.hint ?? `Use at least ${MIN_PASSWORD_LENGTH} characters`];
					return;
				}
				if (setupPassword !== setupConfirm) {
					cancel();
					setupConfirmError = ["Passwords don't match"];
					return;
				}
				if (!acknowledged) {
					cancel();
					setupError = ['Please confirm you have written your password down'];
					return;
				}
			}

			try {
				const built = await buildIdentitySubmission(user.email, setupPassword);
				formData.set('authSecret', built.authSecret);
				formData.set('recipient', built.recipient);
				formData.set('wrapParams', built.wrapParams);
				formData.set('wrapBlob', built.wrapBlob);
				const master = await deriveMasterKey(setupPassword, user.email, MASTER_KEY_VERSIONS[0]);
				stashUnlock({
					email: user.email,
					wrapKey: await deriveWrapKey(master),
					identity: built.identity,
					recipient: built.recipient
				});
			} catch (error) {
				console.error(error);
				cancel();
				setupError = ['Your browser could not generate the keys'];
			}
		},
		async onUpdated({ form }) {
			if (!form.valid) return;
			setupPassword = '';
			setupConfirm = '';
			await initialiseKeyring(user);
			await invalidateAll();
		}
	});

	const setupErrors = setupForm.errors;

	async function lockNow() {
		await lock(user.id);
	}

	async function onUnlockHere(password: string) {
		await unlockWithPassword(user, password);
	}

	async function setEmbedAutoLoad(enabled: boolean) {
		const previous = embedAutoLoad;
		const previousLocal = embedAutoLoad;
		embedAutoLoad = enabled;
		writeLocalEmbedAutoLoadPreference(user.id, enabled);
		embedAutoLoadBusy = true;
		embedAutoLoadProblem = null;
		try {
			const saved = await saveEmbedAutoLoadPreference(enabled);
			if (!saved) {
				embedAutoLoad = previous;
				if (previousLocal !== null) {
					writeLocalEmbedAutoLoadPreference(user.id, previousLocal);
				} else {
					clearLocalEmbedAutoLoadPreference(user.id);
				}
				embedAutoLoadProblem = 'Could not save that preference';
				return;
			}
		} finally {
			embedAutoLoadBusy = false;
		}
	}

	function onEmbedAutoLoadChange(event: Event) {
		const value = (event.currentTarget as HTMLSelectElement).value;
		if (value === 'auto') {
			void setEmbedAutoLoad(true);
			return;
		}
		if (value === 'manual') void setEmbedAutoLoad(false);
	}
</script>

<section>
	<NestedPageHeader
		{backHref}
		backLabel="Back to settings"
		backText="Settings"
		title="Encrypted messages"
		description="Manage the keys that unlock your private message history on this device and future ones."
	/>

	<div class="content">
		<p class="lede">
			Messages to your partners are encrypted on your device. The server keeps a copy so a new phone
			can catch up, but it cannot read any of it — and neither can we.
		</p>
		<p class="lede">
			Need to change your account password or manage passkeys?
			<a href={resolve('/(auth-required)/(app)/settings/security')}>Use Security</a>.
		</p>

		<h2>Do you want to automatically show URL embeds?</h2>
		<p>
			Showing a URL embed requires sending the URL to Bound Up's servers so they can resolve
			previews and players. Those lookups are never logged.
		</p>
		<label class="embed-choice">
			<span>Loading behaviour</span>
			<select
				data-ready={embedAutoLoadReady ? 'true' : undefined}
				value={embedAutoLoadChoice}
				disabled={embedAutoLoadBusy}
				onchange={onEmbedAutoLoadChange}
			>
				<option value="" disabled>You have not chosen a default yet</option>
				<option value="auto">Show automatically</option>
				<option value="manual">Only after I press Show</option>
			</select>
		</label>
		<p class="quiet">
			{#if embedAutoLoad === true}
				Threads render embed placeholders immediately and load actual embeds as they come into view.
			{:else if embedAutoLoad === false}
				Threads wait for you to press Show before any URL embed is loaded.
			{:else}
				You have not chosen a default yet.
			{/if}
		</p>
		{#if embedAutoLoadProblem}<span class="invalid">{embedAutoLoadProblem}</span>{/if}

		<h2>This device</h2>
		{#if keyring.status === 'unlocked'}
			<wa-callout variant="success">
				<wa-icon slot="icon" name="lock-open" variant="solid"></wa-icon>
				Your messages are unlocked here.
				{#if !keyring.durable}
					<br />This browser cannot store your key securely, so you will be asked for your password
					each time you open the app.
				{/if}
			</wa-callout>
			<!-- svelte-ignore a11y_click_events_have_key_events,a11y_no_static_element_interactions -->
			<wa-button appearance="outlined" onclick={lockNow}>Lock on this device</wa-button>
		{:else if keyring.status === 'locked'}
			<wa-callout variant="warning">
				<wa-icon slot="icon" name="lock" variant="solid"></wa-icon>
				<strong>Locked on this device</strong>
				<p>
					Normal — it happens on a new phone, after signing in with a passkey, or when the browser
					has cleared its storage.
				</p>
				<UnlockForm unlock={onUnlockHere} wrongPassword={keyring.reason === 'wrong-password'} />
			</wa-callout>
		{:else if keyring.status === 'absent'}
			<wa-callout variant="neutral">
				<wa-icon slot="icon" name="key" variant="solid"></wa-icon>
				This account has no message keys yet.
			</wa-callout>
		{/if}

		{#if !data.bundle.recipient}
			<h2>{data.hasPassword ? 'Turn on encrypted messages' : 'Choose a password'}</h2>
			{#if data.hasPassword}
				<p>
					Enter your account password. It is used to unlock your messages on a new device, and it
					never leaves this browser.
				</p>
			{:else}
				<div class="explainer">
					<p>
						You sign in with a passkey, which is fine and stays that way — <strong
							>you will not need a password to log in.</strong
						>
					</p>
					<p>
						A password is needed for one thing only: unlocking your message history the first time
						you sign in on a <em>new</em> device. Nobody can recover it for you, so write it down.
					</p>
				</div>
			{/if}

			<form method="POST" action="?/setup" use:setupForm.enhance>
				<PasswordField
					bind:value={setupPassword}
					field="setupPassword"
					label={data.hasPassword ? 'Your account password' : 'New password'}
					autocomplete={data.hasPassword ? 'current-password' : 'new-password'}
					strength={!data.hasPassword}
					errors={setupError ?? $setupErrors.authSecret}
				/>

				{#if !data.hasPassword}
					<PasswordField
						bind:value={setupConfirm}
						field="setupConfirm"
						label="Confirm password"
						autocomplete="new-password"
						errors={setupConfirmError}
					/>

					<div class="generator">
						<!-- svelte-ignore a11y_click_events_have_key_events,a11y_no_static_element_interactions -->
						<wa-button
							type="button"
							appearance="outlined"
							size="s"
							onclick={generatePhrase}
							disabled={generating}
						>
							Suggest a passphrase
						</wa-button>
						{#if generated}
							<output>
								<code>{generated.phrase}</code>
								<span class="quiet">about {generated.entropyBits} bits — write it down</span>
							</output>
						{/if}
					</div>

					<label class="ack">
						<input type="checkbox" bind:checked={acknowledged} />
						<span>
							I have written this password down. I understand that if I lose it, my message history
							is lost with it.
						</span>
					</label>
				{/if}

				<input type="hidden" name="authSecret" value="" />
				<input type="hidden" name="recipient" value="" />
				<input type="hidden" name="wrapParams" value="" />
				<input type="hidden" name="wrapBlob" value="" />
				<wa-button type="submit" variant="brand">
					{data.hasPassword ? 'Turn on encrypted messages' : 'Set my password'}
				</wa-button>
				{#if $setupErrors._errors}<span class="invalid">{$setupErrors._errors}</span>{/if}
			</form>
		{:else}
			<h2>Ways you can unlock</h2>
			<ul class="wraps">
				{#each wraps as wrap (wrap.id)}
					<li>
						<span class="what">
							{wrap.type === 'password' ? 'Your password' : (wrap.label ?? 'A passkey')}
						</span>
						<span class="quiet">
							{wrap.lastUsedAt
								? `last used ${new Date(wrap.lastUsedAt).toLocaleDateString()}`
								: 'never used'}
						</span>
						{#if wraps.length > 1}
							<form method="POST" action="?/revokeWrap" use:setupForm.enhance>
								<input type="hidden" name="wrapId" value={wrap.id} />
								<wa-button type="submit" appearance="plain" size="s">Remove</wa-button>
							</form>
						{/if}
					</li>
				{/each}
			</ul>

			<h2>Forgotten your password?</h2>
			<wa-callout variant="danger">
				<wa-icon slot="icon" name="triangle-exclamation" variant="solid"></wa-icon>
				<strong>This cannot recover your messages.</strong>
				<p>
					Your password is the only key to your message history, and it is not stored anywhere. What
					this does is let you set a <em>new</em> password and a new key, and then ask each partner to
					re-encrypt your shared history to it. They will need to check a safety number with you first.
				</p>
				<form method="POST" action="?/forgetPassword">
					<wa-button type="submit" variant="danger" appearance="outlined">
						Set a new password and start again
					</wa-button>
				</form>
			</wa-callout>
		{/if}
	</div>
</section>

<style>
	section {
		max-width: 40rem;
		margin: 0 auto;
		width: 100%;
		padding-bottom: var(--wa-space-l);

		.content {
			display: flex;
			flex-direction: column;
			gap: var(--wa-space-m);
			padding: var(--wa-space-l);
		}

		h2 {
			margin: var(--wa-space-m) 0 0;
			font-size: 1.125rem;
		}

		p {
			margin: 0;
		}

		.lede,
		.quiet {
			color: var(--wa-color-text-quiet);
		}

		.lede {
			font-size: 0.9375rem;
		}

		.explainer p + p {
			margin-top: 0.5rem;
		}

		form {
			display: flex;
			flex-direction: column;
			gap: 0.75rem;
		}

		.generator {
			display: flex;
			flex-direction: column;
			gap: 0.5rem;

			output {
				display: flex;
				flex-direction: column;
				gap: 0.25rem;

				code {
					font-size: 1rem;
					overflow-wrap: anywhere;
					user-select: all;
				}
			}
		}

		.embed-choice {
			display: flex;
			flex-direction: column;
			gap: 0.35rem;
			max-inline-size: 22rem;

			span {
				font-size: 0.875rem;
				font-weight: var(--wa-font-weight-semibold);
			}

			select {
				font: inherit;
				padding: 0.65rem 0.8rem;
				padding-inline-end: 2.5rem;
				border-radius: 0.75rem;
				border: 1px solid var(--wa-color-surface-border);
				background: var(--wa-color-surface-default, white);
				background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='none' stroke='%239194a2' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.75' d='m3.5 6 4.5 4 4.5-4'/%3E%3C/svg%3E");
				background-position: right 0.9rem center;
				background-repeat: no-repeat;
				background-size: 1rem 1rem;
				color: inherit;
			}
		}

		.ack {
			display: flex;
			gap: 0.5rem;
			align-items: flex-start;
			font-size: 0.875rem;

			input {
				margin-block-start: 0.125rem;
			}
		}

		.wraps {
			list-style: none;
			margin: 0;
			padding: 0;
			display: flex;
			flex-direction: column;
			gap: 0.5rem;

			li {
				display: flex;
				align-items: center;
				gap: 0.5rem;
				flex-wrap: wrap;

				.what {
					font-weight: var(--wa-font-weight-semibold);
				}

				form {
					margin-inline-start: auto;
				}
			}
		}

		.invalid {
			color: var(--wa-color-text-danger);
		}
	}
</style>
