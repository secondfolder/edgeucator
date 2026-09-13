<script lang="ts">
	import type { Infer, SuperForm } from 'sveltekit-superforms';
	import type { PartnerInviteFormSchema } from '$lib/schemas/partnerForm';
	import InputField from './InputField.svelte';

	/**
	 * The four partner questions, shared by the add, accept and edit screens so
	 * the wording and the option order cannot drift between them.
	 *
	 * `editable: false` renders the answers as text plus hidden inputs. The
	 * hidden values are NOT what the server writes — the accept action re-reads
	 * the stored row and ignores anything submitted by someone who does not hold
	 * control. They exist only so the payload still satisfies the same Zod
	 * schema; a disabled input is a rendering decision, not a permission.
	 */
	let {
		superform,
		editable = true,
		partnerNameLabel = "What's their name/title?",
		yourNameLabel = 'What do they call you?'
	}: {
		superform: SuperForm<Infer<PartnerInviteFormSchema>>;
		editable?: boolean;
		partnerNameLabel?: string;
		yourNameLabel?: string;
	} = $props();

	// svelte-ignore state_referenced_locally
	// Captures the initial `superform` on purpose — the store it exposes is
	// live, so there is nothing to gain from tracking the prop itself.
	const { form } = superform;

	// Deliberately not "You / Them / Both": the question is "who's in control?",
	// so the options read as answers to it.
	const controlOptions = [
		{ value: 'me', label: 'Me', hint: 'Only you can change these settings.' },
		{ value: 'them', label: 'Them', hint: 'Only they can change these settings.' },
		{ value: 'mix', label: 'A mix', hint: 'Either of you can change these settings.' }
	] as const;
</script>

{#if editable}
	<InputField {superform} field="partnerName" title={partnerNameLabel} type="text" />
	<InputField {superform} field="yourName" title={yourNameLabel} type="text" />
	<InputField
		{superform}
		field="relationshipLabel"
		title="What is this connection called? (optional)"
		type="text"
	/>
{:else}
	<dl class="readonly">
		<dt>{partnerNameLabel}</dt>
		<dd>{$form.partnerName}</dd>
		<dt>{yourNameLabel}</dt>
		<dd>{$form.yourName}</dd>
		{#if $form.relationshipLabel}
			<dt>What this connection is called</dt>
			<dd>{$form.relationshipLabel}</dd>
		{/if}
	</dl>
	<input type="hidden" name="partnerName" value={$form.partnerName} />
	<input type="hidden" name="yourName" value={$form.yourName} />
	<input type="hidden" name="relationshipLabel" value={$form.relationshipLabel ?? ''} />
{/if}

<!-- Native radios rather than <wa-radio-group>: this control decides a
     permission, so it must submit even if the Web Awesome CDN bundle has not
     upgraded the custom elements yet. -->
<fieldset>
	<legend>Who's in control?</legend>
	{#each controlOptions as option (option.value)}
		<label class:selected={$form.control === option.value}>
			<input
				type="radio"
				name="control"
				value={option.value}
				checked={$form.control === option.value}
				disabled={!editable}
				onchange={() => ($form.control = option.value)}
			/>
			<span>
				{option.label}
				<small>{option.hint}</small>
			</span>
		</label>
	{/each}
	{#if !editable}
		<!-- A disabled radio submits nothing, so the value still has to be sent.
		     Like the names above, the server does not trust it. -->
		<input type="hidden" name="control" value={$form.control} />
	{/if}
</fieldset>

<style>
	.readonly {
		margin: 0;

		dt {
			color: var(--wa-color-text-quiet);
			font-size: 0.875em;
		}

		dd {
			margin: 0 0 0.75rem;
			font-weight: var(--wa-font-weight-semibold, 600);
		}
	}

	fieldset {
		border-color: var(--wa-color-surface-border);
		border-radius: var(--wa-panel-border-radius);
		border-style: var(--wa-panel-border-style);
		border-width: var(--wa-panel-border-width);
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin: 0;

		legend {
			padding: 0 0.25rem;
			color: var(--wa-color-text-quiet);
			font-size: 0.875em;
		}

		label {
			display: flex;
			align-items: flex-start;
			gap: 0.5rem;
			padding: 0.5rem;
			border-radius: var(--wa-panel-border-radius);
			cursor: pointer;

			&.selected {
				background-color: var(--wa-color-surface-raised, transparent);
			}

			span {
				display: flex;
				flex-direction: column;

				small {
					color: var(--wa-color-text-quiet);
				}
			}
		}
	}
</style>
