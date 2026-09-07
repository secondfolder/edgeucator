<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { authClient } from '$lib/auth-client';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let busy = $state(false);
	let message: string | null = $state(null);

	async function addPasskey() {
		busy = true;
		message = null;
		const res = await authClient.passkey.addPasskey({
			name: `${navigator.platform || 'Device'} — ${new Date().toLocaleDateString()}`
		});
		busy = false;
		if (res?.error) {
			// A cancelled ceremony and an already-registered authenticator both
			// come back as errors rather than throwing.
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
</script>

<section>
	<h1>Passkeys</h1>
	<p>
		Passkeys let you sign in with your device instead of a password. A passkey is tied to the domain
		you registered it on.
	</p>

	<wa-button onclick={addPasskey} disabled={busy || undefined}>Add a passkey</wa-button>
	{#if message}<p class="invalid">{message}</p>{/if}

	{#if data.passkeys.length === 0}
		<p>You have no passkeys yet.</p>
	{:else}
		<ul>
			{#each data.passkeys as passkey (passkey.id)}
				<li>
					<span>
						{passkey.name ?? 'Unnamed passkey'}
						<small>{passkey.deviceType}{passkey.backedUp ? ' · synced' : ''}</small>
					</span>
					<wa-button appearance="plain" onclick={() => remove(passkey.id)}>Remove</wa-button>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	section {
		max-width: 40rem;
		margin: 0 auto;
		padding: var(--wa-space-l);
	}

	.invalid {
		color: var(--wa-color-text-danger);
	}

	ul {
		padding: 0;

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
				color: var(--wa-color-text-quiet);
			}
		}
	}
</style>
