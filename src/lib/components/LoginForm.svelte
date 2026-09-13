<script lang="ts">
	import { onMount } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { authClient } from '$lib/auth-client';
	import { MASTER_KEY_VERSIONS } from '$lib/encryption';
	import {
		deriveAuthSecret,
		deriveMasterKey,
		deriveWrapKey,
		WEBCRYPTO_UNAVAILABLE,
		webCryptoAvailable
	} from '$lib/crypto/kdf';
	import { stashUnlock } from '$lib/crypto/stash';
	import type { LoginFormSchema } from '$lib/schemas/loginForm';
	import type { Infer, SuperValidated } from 'sveltekit-superforms';
	import { superForm } from 'sveltekit-superforms';
	import InputField from './InputField.svelte';
	import PasswordField from './PasswordField.svelte';

	let {
		data,
		redirectTo = null
	}: { data: SuperValidated<Infer<LoginFormSchema>>; redirectTo?: string | null } = $props();

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
	let deriving = $state(false);
	let cryptoError: string | null = $state(null);

	// No `onResult` hook any more: there is no client-side auth store to sync a
	// cookie into. The action's 303 triggers a fresh server load, which is the
	// single source of truth for `user`.
	//
	// IMPORTANT: do not add a `validators` option to this form. Client-side
	// validation runs against `$form`, whose `authSecret` is empty until
	// `onSubmit` fills the FormData — and the password field is deliberately not
	// in `$form` at all. It would reject every submission.
	//
	// svelte-ignore state_referenced_locally
	// Captures the load's initial `data` on purpose: `superForm` registers its
	// lifecycle once, and re-running it on every `invalidate()` would reset the
	// form. The stores it returns are the live connection.
	const superform = superForm(data, {
		/**
		 * The password is turned into a key here, in the browser, and only the
		 * derived value is submitted. This is the whole point of the design: no
		 * plaintext password reaches the server, so none can appear in a request
		 * log, an error report or a captured request.
		 *
		 * Superforms awaits every `onSubmit` handler before `enhance` dispatches,
		 * and `formData` is the object it dispatches — verified against
		 * `sveltekit-superforms/dist/client/superForm.js` (the `await
		 * event(submit)` at the top of its submit handler). That is an
		 * implementation detail rather than a documented contract, so there is an
		 * e2e test asserting the posted body never contains the password; it will
		 * fail loudly if this ever stops working.
		 */
		async onSubmit({ formData, cancel }) {
			// Checked before anything is derived so the message can name the real
			// problem — an insecure page — rather than surfacing as the generic
			// "try a different browser" catch below. Plain http on anything but
			// localhost leaves `crypto.subtle` undefined (see kdf.ts).
			if (!webCryptoAvailable()) {
				cancel();
				cryptoError = WEBCRYPTO_UNAVAILABLE;
				return;
			}
			cryptoError = null;
			deriving = true;
			try {
				const email = String(formData.get('email') ?? '');
				// Derived against the newest parameter set. When a second entry is
				// added to MASTER_KEY_VERSIONS, a 401 here should retry with the
				// older ones before reporting a failure — deliberately not written
				// yet, because with one entry it would be untestable dead code. What
				// matters is already in place: each wrap records the params that
				// produced it, so an upgrade needs no "which KDF does this email
				// use?" endpoint, which would be an account-existence oracle.
				const master = await deriveMasterKey(password, email, MASTER_KEY_VERSIONS[0]);
				formData.set('authSecret', await deriveAuthSecret(master));
				// Handed to EncryptionGate on the next screen, so a fresh sign-in does
				// not immediately ask for the same password again.
				stashUnlock({ email, wrapKey: await deriveWrapKey(master) });
			} catch (error) {
				// Cancel rather than let this throw: superforms turns a thrown
				// onSubmit into an onError 500, which would surface as "Internal
				// Error" for what is really "this browser has no WebCrypto".
				console.error(error);
				cancel();
				cryptoError = 'Your browser could not prepare the sign-in. Try a different browser.';
			} finally {
				deriving = false;
			}
		}
	});
	const { errors } = superform;

	let passkeyError: string | null = $state(null);

	async function afterPasskeySignIn() {
		// The ceremony set the session cookie client-side, so server load data is
		// now stale — refetch before navigating.
		await invalidateAll();
		// The password path gets `redirectTo` back from the action's 303; the
		// passkey ceremony never touches the server action, so it has to apply
		// the same destination itself or an invite would be dropped here.
		//
		// no-navigation-without-resolve wants a resolve() call, but this is a
		// runtime path from a query string, not a known route id — there is
		// nothing to resolve against. It is safe because the server ran it
		// through `safeRedirect` in the load before it ever reached this prop.
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		await goto(redirectTo ?? resolve('/'), { invalidateAll: true });
	}

	async function signInWithPasskey() {
		passkeyError = null;
		const res = await authClient.signIn.passkey();
		if (res?.error) {
			passkeyError = res.error.message ?? 'Passkey sign-in failed';
			return;
		}
		await afterPasskeySignIn();
	}

	// Conditional UI: offers passkeys from inside the email field's autofill
	// dropdown. Guarded because not every browser implements it.
	$effect(() => {
		let cancelled = false;
		void (async () => {
			if (typeof PublicKeyCredential === 'undefined') return;
			if (!(await PublicKeyCredential.isConditionalMediationAvailable?.())) return;
			const res = await authClient.signIn.passkey({ autoFill: true });
			if (cancelled || !res || res.error) return;
			await afterPasskeySignIn();
		})();
		return () => {
			cancelled = true;
		};
	});
</script>

<form method="POST" use:superform.enhance data-ready={hydrated ? 'true' : null}>
	<noscript>
		<!-- Said before a wasted round trip, not after it. Signing in genuinely
		     cannot work without JavaScript now: the server has nothing to check,
		     because it never receives a password. -->
		<p class="invalid">
			Signing in needs JavaScript. Your password is turned into a key in this browser and never sent
			to the server, so there is nothing for the server to check without it.
		</p>
	</noscript>

	<InputField
		{superform}
		field="email"
		title="Email"
		type="email"
		autocomplete="username webauthn"
	/>
	<PasswordField
		bind:value={password}
		field="password"
		label="Password"
		autocomplete="current-password"
		errors={$errors.authSecret}
	/>
	<!-- Empty in the HTML and filled by onSubmit. With no JavaScript it posts
	     blank, which the Zod field rejects with a message naming the real cause. -->
	<input type="hidden" name="authSecret" value="" />

	<wa-button type="submit" disabled={!hydrated || deriving}>Login</wa-button>
	{#if cryptoError}<span class="invalid">{cryptoError}</span>{/if}
	{#if $errors._errors}<span class="invalid">{$errors._errors}</span>{/if}

	<div class="divider">or</div>
	<!-- svelte-ignore a11y_click_events_have_key_events,a11y_no_static_element_interactions -->
	<wa-button type="button" appearance="outlined" onclick={signInWithPasskey}>
		Sign in with a passkey
	</wa-button>
	{#if passkeyError}<span class="invalid">{passkeyError}</span>{/if}
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

		.divider {
			text-align: center;
			color: var(--wa-color-text-quiet);
			font-size: 0.875em;
		}
	}
</style>
