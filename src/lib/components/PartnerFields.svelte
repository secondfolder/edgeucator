<script lang="ts">
	import type { Infer, SuperForm } from 'sveltekit-superforms';
	import type { PartnerInviteFormSchema } from '$lib/schemas/partnerForm';
	import InputField from './InputField.svelte';

	/**
	 * The partner questions, shared by the add, accept and edit screens so
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
		editable = true
	}: {
		superform: SuperForm<Infer<PartnerInviteFormSchema>>;
		editable?: boolean;
	} = $props();

	// svelte-ignore state_referenced_locally
	// Captures the initial `superform` on purpose — the store it exposes is
	// live, so there is nothing to gain from tracking the prop itself.
	const { form } = superform;

	// Deliberately not "You / Them / Both": the question is "who calls the
	// shots?", so the options read as answers to it.
	const controlOptions = [
		{ value: 'me', label: 'Me' },
		{ value: 'them', label: 'Them' },
		{ value: 'mix', label: 'A mix' }
	] as const;
</script>

{#if editable}
	<fieldset class="question-fieldset">
		<legend>Name/Title</legend>
		<p class="question-description">How should you both refer to each other?</p>
		<div class="inline-fields">
			<div class="field-item">
				<InputField {superform} field="partnerName" title="Theirs" type="text" />
			</div>
			<div class="field-item">
				<InputField {superform} field="yourName" title="Yours" type="text" />
			</div>
		</div>
	</fieldset>

	<fieldset class="question-fieldset">
		<legend>Roles</legend>
		<div class="stacked-fields">
			<div class="field-item">
				<InputField
					{superform}
					field="partnerRole"
					title="Theirs"
					type="text"
					startText={$form.yourName ? `${$form.yourName}'s` : null}
				/>
			</div>
			<div class="field-item">
				<InputField
					{superform}
					field="yourRole"
					title="Yours"
					type="text"
					startText={$form.partnerName ? `${$form.partnerName}'s` : null}
				/>
			</div>
		</div>
	</fieldset>
{:else}
	<fieldset class="question-fieldset">
		<legend>Name/Title</legend>
		<p class="question-description">How should you both refer to each other?</p>
		<dl class="readonly">
			<dt>Theirs</dt>
			<dd>{$form.partnerName}</dd>
			<dt>Yours</dt>
			<dd>{$form.yourName}</dd>
		</dl>
	</fieldset>

	<fieldset class="question-fieldset">
		<legend>Roles</legend>
		<dl class="readonly">
			{#if $form.partnerRole}
				<dt>Theirs</dt>
				<dd>{$form.yourName ? `${$form.yourName}'s ` : ''}{$form.partnerRole}</dd>
			{/if}
			{#if $form.yourRole}
				<dt>Yours</dt>
				<dd>{$form.partnerName ? `${$form.partnerName}'s ` : ''}{$form.yourRole}</dd>
			{/if}
		</dl>
	</fieldset>
	<input type="hidden" name="partnerName" value={$form.partnerName} />
	<input type="hidden" name="yourName" value={$form.yourName} />
	<input type="hidden" name="partnerRole" value={$form.partnerRole ?? ''} />
	<input type="hidden" name="yourRole" value={$form.yourRole ?? ''} />
{/if}

{#if editable}
	<!-- Native radios rather than <wa-radio-group>: this control decides a
	     permission, so it must submit even if the Web Awesome CDN bundle has not
	     upgraded the custom elements yet. -->
	<fieldset class="control-fieldset">
		<legend>Who calls the shots?</legend>
		<p class="control-description">
			This decides who can set tasks, punishments, rewards and other settings for this link.
		</p>
		<div class="control-options">
			{#each controlOptions as option (option.value)}
				<label class:selected={$form.control === option.value}>
					<input
						type="radio"
						name="control"
						value={option.value}
						checked={$form.control === option.value}
						onchange={() => ($form.control = option.value)}
					/>
					{option.label}
				</label>
			{/each}
		</div>
	</fieldset>
{:else}
	<!-- The question is not shown at all to someone who cannot change the
	     answer — a row of disabled radios is noise, not information. The value
	     still has to be sent so the payload matches the same Zod schema; like
	     the names above, the server does not trust it and re-reads the stored
	     row (see invariant 14 in AGENTS.md). -->
	<input type="hidden" name="control" value={$form.control} />
{/if}

<style>
	.question-fieldset,
	.control-fieldset {
		border-color: var(--wa-color-surface-border);
		border-radius: var(--wa-panel-border-radius);
		border-style: var(--wa-panel-border-style);
		border-width: var(--wa-panel-border-width);
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin: 1rem 0 0;
		min-width: 0;

		legend {
			padding: 0 0.25rem;
			color: var(--wa-color-text-normal);
			font-size: 1.25rem;
			font-weight: var(--wa-font-weight-semibold, 600);
		}
	}

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

	.question-description {
		margin: 0;
		padding: 0 0.25rem;
		color: var(--wa-color-text-quiet);
	}

	.inline-fields {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	.stacked-fields {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.field-item {
		/* Half-width by default so the two fields stay on one row until the
		   fieldset is genuinely narrow, then wrap cleanly. */
		flex: 1 1 calc((100% - 0.75rem) / 2);
		min-width: 14rem;

		:global(.field) {
			width: 100%;
		}
	}

	.control-fieldset {
		gap: 0.5rem;
	}

	.control-description {
		margin: 0;
		padding: 0 0.25rem;
		color: var(--wa-color-text-quiet);
	}

	.control-options {
		/* One line when there is room; wraps onto the next when there is not. */
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
	}

	label {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem;
		border-radius: var(--wa-panel-border-radius);
		cursor: pointer;

		&.selected {
			background-color: var(--wa-color-surface-raised, transparent);
		}
	}
</style>
