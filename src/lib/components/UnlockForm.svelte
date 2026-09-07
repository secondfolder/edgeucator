<script lang="ts">
	import { MIN_PASSWORD_LENGTH } from '$lib/password-strength';
	import PasswordField from './PasswordField.svelte';

	/**
	 * Asks for the password so the message identity can be unsealed.
	 *
	 * A normal screen, not an error state. It is reached on a new device, after
	 * signing in with a passkey, and whenever the browser has evicted its
	 * storage — iOS drops IndexedDB after about a week of inactivity, so this is
	 * something a regular user will see regularly.
	 *
	 * `unlock` is injected so the component tests can drive it without WebCrypto
	 * or IndexedDB, neither of which jsdom has.
	 */
	let {
		unlock,
		wrongPassword = false,
		busyLabel = 'Unlocking…',
		submitLabel = 'Unlock messages'
	}: {
		unlock: (password: string) => Promise<void>;
		wrongPassword?: boolean;
		busyLabel?: string;
		submitLabel?: string;
	} = $props();

	let password = $state('');
	let busy = $state(false);
	let failed = $state(false);

	async function onSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (busy || password.length === 0) return;
		failed = false;
		busy = true;
		try {
			await unlock(password);
		} finally {
			busy = false;
			// Cleared whether it worked or not: on success it is not needed, and on
			// failure leaving it in the box invites a retry of the same wrong value.
			password = '';
		}
	}

	const showError = $derived(wrongPassword || failed);
</script>

<form onsubmit={onSubmit}>
	<PasswordField
		bind:value={password}
		field="unlockPassword"
		label="Your password"
		autocomplete="current-password"
		errors={showError ? ['That password did not unlock your messages'] : undefined}
	/>
	<!-- disabled={busy}, never `busy || undefined` — invariant 11. -->
	<wa-button type="submit" variant="brand" disabled={busy}>
		{busy ? busyLabel : submitLabel}
	</wa-button>
	<p class="note">
		This is the password you signed up with. It is checked on this device, not sent anywhere — if it
		is wrong you will be told instantly. Needs at least {MIN_PASSWORD_LENGTH} characters.
	</p>
</form>

<style>
	form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;

		.note {
			margin: 0;
			font-size: 0.8125rem;
			color: var(--wa-color-text-quiet);
		}
	}
</style>
