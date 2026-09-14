<script lang="ts">
	import { onMount } from 'svelte';
	import type { SuperValidated, Infer } from 'sveltekit-superforms';
	import { superForm } from 'sveltekit-superforms';
	import { MASTER_KEY_VERSIONS } from '$lib/encryption';
	import {
		deriveAuthSecret,
		deriveMasterKey,
		deriveWrapKey,
		WEBCRYPTO_UNAVAILABLE,
		webCryptoAvailable
	} from '$lib/crypto/kdf';
	import { generateAgeIdentity } from '$lib/crypto/identity';
	import { wrapIdentity } from '$lib/crypto/wrap';
	import { stashUnlock } from '$lib/crypto/stash';
	import { MIN_PASSWORD_LENGTH, scorePassword } from '$lib/password-strength';
	import type { SignupFormSchema } from '$lib/schemas/signupForm';
	import { currentTimeZoneOrUtc } from '$lib/timezone';
	import InputField from './InputField.svelte';
	import PasswordField from './PasswordField.svelte';

	let { data }: { data: SuperValidated<Infer<SignupFormSchema>> } = $props();

	/**
	 * Whether the form can actually do anything yet.
	 *
	 * The submit button is a `<wa-button>` and the form's behaviour lives in
	 * `use:superform.enhance`, and until both are live a click either does
	 * nothing at all or posts an empty `authSecret` and comes back with a
	 * message about JavaScript being disabled — when it is enabled, just not
	 * ready. Both are confusing, and the second is actively misleading.
	 *
	 * So the button stays disabled until an effect has run, which only happens
	 * on the client after hydration. `data-ready` on the form is the same fact
	 * for the Playwright suite, which needs something unambiguous to wait on:
	 * the custom element registry is not enough, because the element can be
	 * upgraded before Svelte has attached the form's behaviour.
	 */
	let hydrated = $state(false);
	// onMount rather than $effect: this is "has the client taken over yet",
	// which is not derived from anything, and $effect here trips
	// svelte/prefer-writable-derived for suggesting it should be.
	onMount(() => {
		hydrated = true;
	});

	let password = $state('');
	let passwordConfirm = $state('');
	let passwordError: string[] | undefined = $state(undefined);
	let confirmError: string[] | undefined = $state(undefined);
	let cryptoError: string | null = $state(null);
	let working = $state(false);

	// No `onResult` hook: Better Auth's cookies are httpOnly and the action's
	// 303 triggers a fresh server load, so there is nothing to sync client-side.
	//
	// IMPORTANT: do not add a `validators` option here. See the same note in
	// LoginForm.svelte — the password fields are deliberately not in `$form`.
	//
	// svelte-ignore state_referenced_locally
	// Captures the load's initial `data` on purpose: `superForm` registers its
	// lifecycle once, and re-running it on every `invalidate()` would reset the
	// form. The stores it returns are the live connection.
	const superform = superForm(data, {
		/**
		 * Everything cryptographic happens here, before anything is posted:
		 * derive the master key from the password, generate this account's age
		 * identity, seal it under a key derived from the same password, and post
		 * the sealed blob plus the public recipient.
		 *
		 * The server therefore stores a key it cannot open and a public key that
		 * opens nothing, and has never seen the password that connects them.
		 *
		 * Password strength and confirmation are checked here too, because this
		 * is now the only place that can: the server receives a fixed-length
		 * derived value and cannot tell a passphrase from a single character. See
		 * the comment in `src/lib/schemas/keyWrap.ts`.
		 */
		async onSubmit({ formData, cancel }) {
			passwordError = undefined;
			confirmError = undefined;
			cryptoError = null;
			formData.set('timezone', currentTimeZoneOrUtc());

			// Before any of the crypto below runs, so an insecure page gets the
			// message that names the problem rather than the generic catch's
			// "try a different browser". crypto.subtle is undefined off secure
			// contexts (plain http on anything but localhost) — see kdf.ts.
			if (!webCryptoAvailable()) {
				cancel();
				cryptoError = WEBCRYPTO_UNAVAILABLE;
				return;
			}

			const strength = scorePassword(password);
			if (!strength.acceptable) {
				cancel();
				passwordError = [strength.hint ?? `Use at least ${MIN_PASSWORD_LENGTH} characters`];
				return;
			}
			if (password !== passwordConfirm) {
				cancel();
				confirmError = ["Passwords don't match"];
				return;
			}

			working = true;
			try {
				const email = String(formData.get('email') ?? '');
				const master = await deriveMasterKey(password, email, MASTER_KEY_VERSIONS[0]);
				const wrapKey = await deriveWrapKey(master);
				const { identity, recipient } = await generateAgeIdentity();

				formData.set('authSecret', await deriveAuthSecret(master));
				formData.set('recipient', recipient);
				formData.set('wrapBlob', await wrapIdentity({ wrapKey, identity, recipient }));
				formData.set(
					'wrapParams',
					JSON.stringify({
						type: 'password',
						kdf: MASTER_KEY_VERSIONS[0].kdf,
						version: MASTER_KEY_VERSIONS[0].version,
						iterations: MASTER_KEY_VERSIONS[0].iterations
					})
				);

				// The identity travels too, so the gate on the next screen can cache
				// it without re-deriving anything.
				stashUnlock({ email, wrapKey, identity, recipient });
			} catch (error) {
				console.error(error);
				cancel();
				cryptoError =
					'Your browser could not set up encryption. Try a different browser — this app needs modern WebCrypto.';
			} finally {
				working = false;
			}
		}
	});
	const { errors } = superform;
</script>

<form method="POST" use:superform.enhance data-ready={hydrated ? 'true' : null}>
	<noscript>
		<p class="invalid">
			Signing up needs JavaScript. Your encryption keys are generated in this browser, and your
			password never reaches the server.
		</p>
	</noscript>

	<InputField {superform} field="name" title="Name" type="text" autocomplete="name" />
	<InputField {superform} field="email" title="Email" type="email" autocomplete="username" />

	<PasswordField
		bind:value={password}
		field="password"
		label="Password"
		autocomplete="new-password"
		strength
		errors={passwordError ?? $errors.authSecret}
	/>
	<PasswordField
		bind:value={passwordConfirm}
		field="passwordConfirm"
		label="Confirm password"
		autocomplete="new-password"
		errors={confirmError}
	/>

	<!--
		Calm and brief, on purpose. The full "if you lose this, your message
		history is gone" warning belongs on the messaging page, where the user is
		about to have a history worth losing — putting it here would be alarming
		about something they have not started using yet.
	-->
	<p class="note">
		This password also encrypts your private messages, so pick a strong one and write it down
		somewhere safe.
	</p>

	<input type="hidden" name="authSecret" value="" />
	<input type="hidden" name="recipient" value="" />
	<input type="hidden" name="wrapParams" value="" />
	<input type="hidden" name="wrapBlob" value="" />
	<input type="hidden" name="timezone" value="" />

	<wa-button type="submit" disabled={!hydrated || working}>Sign Up</wa-button>
	{#if cryptoError}<span class="invalid">{cryptoError}</span>{/if}
	{#if $errors._errors}<span class="invalid">{$errors._errors}</span>{/if}
</form>

<style>
	form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		max-width: 300px;
		margin: 0 auto;
		border-color: var(--border-color, var(--wa-color-surface-border));
		border-radius: var(--wa-panel-border-radius);
		border-style: var(--wa-panel-border-style);
		border-width: var(--wa-panel-border-width);
		padding: var(--wa-space-l);

		.invalid {
			color: var(--wa-color-text-danger);
		}

		.note {
			margin: 0;
			font-size: 0.8125rem;
			color: var(--wa-color-text-quiet);
		}
	}
</style>
