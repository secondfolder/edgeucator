<script lang="ts">
	import PartnerFields from './PartnerFields.svelte';
	import type { PartnerAcceptFormSchema } from '$lib/schemas/partnerForm';
	import { superForm, type Infer, type SuperValidated } from 'sveltekit-superforms';

	/**
	 * The accept half of the invite page.
	 *
	 * Its own component rather than a branch of `{#if}` in the page, because
	 * `superForm()` has to be called exactly once for the life of the form — an
	 * `{@const}` inside a conditional block re-runs it whenever the branch
	 * re-renders and silently throws away the field state.
	 */
	let {
		data,
		editable
	}: { data: SuperValidated<Infer<PartnerAcceptFormSchema>>; editable: boolean } = $props();

	const superform = superForm(data);
	const { errors, submitting } = superform;
</script>

<form method="POST" use:superform.enhance>
	<PartnerFields
		{superform}
		{editable}
		partnerNameLabel="What you call them"
		yourNameLabel="What they call you"
	/>

	<!-- `disabled={x}`, never `disabled={x || undefined}`. Once Web Awesome
	     upgrades the element Svelte assigns to the `disabled` *property*, and
	     this alpha coerces `undefined` to true — leaving the button permanently
	     disabled. A plain boolean assigns false and behaves. -->
	<wa-button type="submit" disabled={$submitting}>Accept and link</wa-button>
	{#if $errors._errors}<span class="invalid">{$errors._errors}</span>{/if}
</form>

<style>
	form {
		display: flex;
		flex-direction: column;
		gap: 1rem;

		.invalid {
			color: var(--wa-color-text-danger);
		}
	}
</style>
