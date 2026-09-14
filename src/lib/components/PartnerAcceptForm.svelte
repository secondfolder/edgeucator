<script lang="ts">
	import PartnerFields from './PartnerFields.svelte';
	import type { PartnerAcceptFormSchema } from '$lib/schemas/partnerForm';
	import type { Snippet } from 'svelte';
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
		editable,
		children
	}: {
		data: SuperValidated<Infer<PartnerAcceptFormSchema>>;
		editable: boolean;
		children?: Snippet;
	} = $props();

	// svelte-ignore state_referenced_locally
	// Captures the load's initial `data` on purpose: `superForm` registers its
	// lifecycle once, and re-running it on every `invalidate()` would reset the
	// form. The stores it returns are the live connection.
	const superform = superForm(data);
	const { errors, submitting } = superform;
</script>

<!-- The submit button lives outside the form, on a shared row with the
     "Not now" link the page passes in via the default slot — `form="partner-accept"`
     re-associates it, so it still submits through superforms' enhance. -->
<form id="partner-accept" method="POST" use:superform.enhance>
	<PartnerFields {superform} {editable} />
</form>

<div class="actions">
	<!-- `disabled={x}`, never `disabled={x || undefined}`. Once Web Awesome
	     upgrades the element Svelte assigns to the `disabled` *property*, and
	     this alpha coerces `undefined` to true — leaving the button permanently
	     disabled. A plain boolean assigns false and behaves. -->
	<wa-button type="submit" form="partner-accept" disabled={$submitting}>Accept and link</wa-button>
	{#if $errors._errors}<span class="invalid">{$errors._errors}</span>{/if}
	{@render children?.()}
</div>

<style>
	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;

		.invalid {
			color: var(--wa-color-text-danger);
		}
	}
</style>
