<script lang="ts">
	import type { SuperValidated, Infer } from 'sveltekit-superforms';
	import { superForm } from 'sveltekit-superforms';
	import type { SignupFormSchema } from '$lib/schemas/signupForm';
	import InputField from './InputField.svelte';
	import { pb } from '$lib/pocketbase';

	let { data }: { data: SuperValidated<Infer<SignupFormSchema>> } = $props();

	const superform = superForm(data, {
		onResult: () => {
			pb.authStore.loadFromCookie(document.cookie);
		}
	});
	const { errors } = superform;
</script>

<form method="POST" use:superform.enhance>
	<InputField {superform} field="email" title="Email" type="email" />
	<InputField {superform} field="password" title="Password" type="password" />
	<InputField {superform} field="passwordConfirm" title="Confirm Password" type="password" />
	<wa-button type="submit">Sign Up</wa-button>
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
	}
</style>
