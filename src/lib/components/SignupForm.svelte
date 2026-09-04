<script lang="ts">
	import type { SuperValidated, Infer } from 'sveltekit-superforms';
	import { superForm } from 'sveltekit-superforms';
	import type { SignupFormSchema } from '$lib/schemas/signupForm';
	import InputField from './InputField.svelte';

	let { data }: { data: SuperValidated<Infer<SignupFormSchema>> } = $props();

	// No `onResult` hook: Better Auth's cookies are httpOnly and the action's
	// 303 triggers a fresh server load, so there is nothing to sync client-side.
	const superform = superForm(data);
	const { errors } = superform;
</script>

<form method="POST" use:superform.enhance>
	<InputField {superform} field="name" title="Name" type="text" autocomplete="name" />
	<InputField {superform} field="email" title="Email" type="email" autocomplete="username" />
	<InputField
		{superform}
		field="password"
		title="Password"
		type="password"
		autocomplete="new-password"
	/>
	<InputField
		{superform}
		field="passwordConfirm"
		title="Confirm Password"
		type="password"
		autocomplete="new-password"
	/>
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
