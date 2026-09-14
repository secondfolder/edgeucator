<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import InputField from '$lib/components/InputField.svelte';
	import NestedPageHeader from '$lib/components/NestedPageHeader.svelte';
	import { superForm } from 'sveltekit-superforms';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let ready = $state(false);
	const backHref = resolve('/(auth-required)/(app)/settings');
	const user = $derived(page.data.user);

	onMount(() => {
		ready = true;
	});

	// svelte-ignore state_referenced_locally
	// Captures the load's initial `data.accountForm` on purpose: `superForm`
	// registers its lifecycle once, and re-running it on every `invalidate()`
	// would reset the form. `resetForm: false` keeps a failed submit populated.
	const superform = superForm(data.accountForm, {
		resetForm: false,
		async onUpdated({ form }) {
			if (!form.valid) return;
			await invalidateAll();
		}
	});
	const { errors, submitting } = superform;
</script>

<section>
	<NestedPageHeader
		{backHref}
		backLabel="Back to settings"
		backText="Settings"
		title="Account"
		description="Update the name shown around the app and review the sign-in details on this account."
	/>

	<div class="content">
		<form
			method="POST"
			action="?/update"
			use:superform.enhance
			data-ready={ready ? 'true' : undefined}
		>
			<InputField {superform} field="name" title="Name" type="text" autocomplete="name" />

			<wa-button type="submit" disabled={$submitting}>Save account details</wa-button>
			{#if $errors._errors}<span class="invalid">{$errors._errors}</span>{/if}
		</form>

		{#if user}
			<div class="email-panel">
				<h2>Email</h2>
				<p class="value">{user.email}</p>
				<p>
					Email changes are not available yet. This app ties email to both sign-in credentials and
					encrypted-message access, so changing it safely needs coordinated auth and key-migration
					work.
				</p>
			</div>
		{/if}

		<div class="linked-setting">
			<h2>Password and sign-in</h2>
			<p>Change your password, manage passkeys, and review sign-in settings from Security.</p>
			<a href={resolve('/(auth-required)/(app)/settings/security')}>Open security settings</a>
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
			gap: 1rem;
			padding: var(--wa-space-l);
		}

		h2,
		p {
			margin: 0;
		}

		.email-panel p,
		.linked-setting p {
			color: var(--wa-color-text-quiet);
		}

		form {
			display: flex;
			flex-direction: column;
			gap: 1rem;
		}

		.email-panel,
		.linked-setting {
			display: flex;
			flex-direction: column;
			gap: 0.5rem;
			padding: 1rem;
			border: 1px solid var(--wa-color-surface-border);
			border-radius: var(--wa-border-radius-l);
			background: var(--wa-color-surface-raised);
		}

		.email-panel {
			.value {
				font-weight: var(--wa-font-weight-semibold, 600);
				color: var(--wa-color-text-normal);
			}
		}

		.invalid {
			color: var(--wa-color-text-danger);
		}
	}
</style>
