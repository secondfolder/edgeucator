<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { authClient } from '$lib/auth-client';
	import NestedPageHeader from '$lib/components/NestedPageHeader.svelte';
	import PasswordField from '$lib/components/PasswordField.svelte';
	import { buildPasswordChange } from '$lib/crypto/setup';
	import {
		deriveAuthSecret,
		deriveMasterKey,
		webCryptoAvailable,
		WEBCRYPTO_UNAVAILABLE
	} from '$lib/crypto/kdf';
	import { MIN_PASSWORD_LENGTH, scorePassword } from '$lib/password-strength';
	import { superForm } from 'sveltekit-superforms';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const backHref = resolve('/(auth-required)/(app)/settings');
	let ready = $state(false);

	const user = $derived(page.data.user as { id: string; email: string });
	const wraps = $derived(data.bundle.wraps);

	// Matches the login/signup readiness marker. Without it, a fast fill can land
	// before `use:changeForm.enhance`, and hydration then writes the empty local
	// password state back over what the DOM briefly held.
	onMount(() => {
		ready = true;
	});

	let busy = $state(false);
	let message: string | null = $state(null);

	let oldPassword = $state('');
	let newPassword = $state('');
	let newConfirm = $state('');
	let changeError: string[] | undefined = $state(undefined);
	let changeConfirmError: string[] | undefined = $state(undefined);

	async function addPasskey() {
		busy = true;
		message = null;
		const res = await authClient.passkey.addPasskey({
			name: `${navigator.platform || 'Device'} — ${new Date().toLocaleDateString()}`
		});
		busy = false;
		if (res?.error) {
			message = res.error.message ?? 'Could not add passkey';
			return;
		}
		await invalidateAll();
	}

	async function remove(id: string) {
		const res = await authClient.passkey.deletePasskey({ id });
		if (res?.error) {
			message = res.error.message ?? 'Could not remove passkey';
			return;
		}
		await invalidateAll();
	}

	// svelte-ignore state_referenced_locally
	// Captures the load's initial `data.changeForm` on purpose: `superForm`
	// registers its lifecycle once, and re-running it on every `invalidate()`
	// would reset the form. `resetForm: false` keeps a failed submit populated.
	const changeForm = superForm(data.changeForm, {
		id: 'change',
		resetForm: false,
		async onSubmit({ formData, cancel }) {
			changeError = undefined;
			changeConfirmError = undefined;

			if (!webCryptoAvailable()) {
				cancel();
				changeError = [WEBCRYPTO_UNAVAILABLE];
				return;
			}

			const strength = scorePassword(newPassword);
			if (!strength.acceptable) {
				cancel();
				changeConfirmError = [strength.hint ?? `Use at least ${MIN_PASSWORD_LENGTH} characters`];
				return;
			}
			if (newPassword !== newConfirm) {
				cancel();
				changeConfirmError = ["Passwords don't match"];
				return;
			}

			try {
				if (data.bundle.recipient) {
					const built = await buildPasswordChange({
						email: user.email,
						oldPassword,
						newPassword,
						recipient: data.bundle.recipient,
						wraps
					}).catch((error) => {
						console.error(error);
						return null;
					});

					if (!built) {
						cancel();
						changeError = ['That password did not unlock your messages'];
						return;
					}

					formData.set('currentAuthSecret', built.currentAuthSecret);
					formData.set('newAuthSecret', built.newAuthSecret);
					formData.set('wrapParams', built.wrapParams);
					formData.set('wrapBlob', built.wrapBlob);
					return;
				}

				const currentMaster = await deriveMasterKey(oldPassword, user.email);
				const newMaster = await deriveMasterKey(newPassword, user.email);
				formData.set('currentAuthSecret', await deriveAuthSecret(currentMaster));
				formData.set('newAuthSecret', await deriveAuthSecret(newMaster));
			} catch (error) {
				console.error(error);
				cancel();
				changeError = ['Your browser could not prepare the password change'];
			}
		},
		async onUpdated({ form }) {
			if (!form.valid) return;
			oldPassword = '';
			newPassword = '';
			newConfirm = '';
			await invalidateAll();
		}
	});
	const changeErrors = changeForm.errors;
</script>

<section>
	<NestedPageHeader
		{backHref}
		backLabel="Back to settings"
		backText="Settings"
		title="Security"
		description="Manage passkeys, account-password changes, and where to go for encrypted-message recovery."
	/>

	<div class="content">
		<h2>Passkeys</h2>
		<p>
			Passkeys let you sign in with your device instead of a password. A passkey is tied to the
			domain you registered it on.
		</p>

		<!-- `disabled={busy}`, not `disabled={busy || undefined}`: once Web Awesome
	     upgrades the element Svelte assigns to the `disabled` property, this alpha
	     coerces `undefined` to true and leaves the button permanently disabled. -->
		<!-- svelte-ignore a11y_click_events_have_key_events,a11y_no_static_element_interactions -->
		<wa-button onclick={addPasskey} disabled={busy}>Add a passkey</wa-button>
		{#if message}<p class="invalid">{message}</p>{/if}

		{#if data.passkeys.length === 0}
			<p>You have no passkeys yet.</p>
		{:else}
			<ul class="passkeys">
				{#each data.passkeys as passkey (passkey.id)}
					<li>
						<span>
							{passkey.name ?? 'Unnamed passkey'}
							<small>{passkey.deviceType}{passkey.backedUp ? ' · synced' : ''}</small>
						</span>
						<!-- svelte-ignore a11y_click_events_have_key_events,a11y_no_static_element_interactions -->
						<wa-button appearance="plain" onclick={() => remove(passkey.id)}>Remove</wa-button>
					</li>
				{/each}
			</ul>
		{/if}

		<h2>Password</h2>
		{#if data.hasPassword}
			<p>
				{data.bundle.recipient
					? 'If you already use encrypted messages, changing your password also re-seals the key that unlocks your history.'
					: 'Change the password you use for email sign-in.'}
			</p>
			<form
				method="POST"
				action="?/changePassword"
				use:changeForm.enhance
				data-ready={ready ? 'true' : undefined}
			>
				<PasswordField
					bind:value={oldPassword}
					field="oldPassword"
					label="Current password"
					autocomplete="current-password"
					errors={changeError ?? $changeErrors.currentAuthSecret}
				/>
				<PasswordField
					bind:value={newPassword}
					field="newPassword"
					label="New password"
					autocomplete="new-password"
					strength
				/>
				<PasswordField
					bind:value={newConfirm}
					field="newConfirm"
					label="Confirm new password"
					autocomplete="new-password"
					errors={changeConfirmError}
				/>
				<input type="hidden" name="currentAuthSecret" value="" />
				<input type="hidden" name="newAuthSecret" value="" />
				{#if data.bundle.recipient}
					<input type="hidden" name="wrapParams" value="" />
					<input type="hidden" name="wrapBlob" value="" />
				{/if}
				<wa-button type="submit" variant="brand">Change password</wa-button>
				{#if $changeErrors._errors}<span class="invalid">{$changeErrors._errors}</span>{/if}
			</form>
		{:else}
			<wa-callout variant="neutral">
				<wa-icon slot="icon" name="key" variant="solid"></wa-icon>
				This account signs in with passkeys only right now. If you turn on encrypted messages, you will
				choose a password there so a new device can unlock your history.
			</wa-callout>
		{/if}

		<div class="linked-setting">
			<h2>Encrypted messages</h2>
			<p>
				Message history uses its own key settings. Visit Encrypted messages to turn messaging on,
				reset after forgetting that password, or remove old unlock methods.
			</p>
			<a href={resolve('/(auth-required)/(app)/settings/encryption')}>Open encrypted messages</a>
		</div>
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

		p {
			margin: 0;
		}

		h2 {
			font-size: 1.125rem;
			margin-top: var(--wa-space-s);
		}

		.linked-setting p,
		small {
			color: var(--wa-color-text-quiet);
		}

		form {
			display: flex;
			flex-direction: column;
			gap: 0.75rem;
		}

		.passkeys {
			padding: 0;
			margin: 0;

			li {
				list-style-type: none;
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 1rem;
				padding: 0.5rem 0;
				border-bottom: 1px solid var(--wa-color-surface-border);

				small {
					display: block;
				}
			}
		}

		.linked-setting {
			display: flex;
			flex-direction: column;
			gap: 0.5rem;
			padding: 1rem;
			border: 1px solid var(--wa-color-surface-border);
			border-radius: var(--wa-border-radius-l);
			background: var(--wa-color-surface-raised);
		}

		.invalid {
			color: var(--wa-color-text-danger);
		}
	}
</style>
