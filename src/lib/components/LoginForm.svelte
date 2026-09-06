<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { authClient } from '$lib/auth-client';
	import type { LoginFormSchema } from '$lib/schemas/loginForm';
	import type { Infer, SuperValidated } from 'sveltekit-superforms';
	import { superForm } from 'sveltekit-superforms';
	import InputField from './InputField.svelte';

	let { data }: { data: SuperValidated<Infer<LoginFormSchema>> } = $props();

	// No `onResult` hook any more: there is no client-side auth store to sync a
	// cookie into. The action's 303 triggers a fresh server load, which is the
	// single source of truth for `user`.
	const superform = superForm(data);
	const { errors } = superform;

	let passkeyError: string | null = $state(null);

	async function afterPasskeySignIn() {
		// The ceremony set the session cookie client-side, so server load data is
		// now stale — refetch before navigating.
		await invalidateAll();
		await goto(resolve('/'), { invalidateAll: true });
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

<form method="POST" use:superform.enhance>
	<InputField
		{superform}
		field="email"
		title="Email"
		type="email"
		autocomplete="username webauthn"
	/>
	<InputField
		{superform}
		field="password"
		title="Password"
		type="password"
		autocomplete="current-password"
	/>
	<wa-button type="submit">Login</wa-button>
	{#if $errors._errors}<span class="invalid">{$errors._errors}</span>{/if}

	<div class="divider">or</div>
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
