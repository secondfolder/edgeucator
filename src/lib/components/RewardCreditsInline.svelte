<script lang="ts">
	type EditableCredit = {
		action: string;
		inputLabel: string;
		editLabel: string;
		saveLabel: string;
		cancelLabel: string;
		targetUserId?: string | null;
		targetUserIdField?: string;
	};

	let {
		credits,
		label = null,
		unit = 'credits',
		editable = null,
		compact = false,
		showLabel = true
	}: {
		credits: number;
		label?: string | null;
		unit?: string | null;
		editable?: EditableCredit | null;
		compact?: boolean;
		showLabel?: boolean;
	} = $props();

	let editing = $state(false);
	let draft = $state('');

	function startEditing() {
		draft = String(credits);
		editing = true;
	}

	function cancelEditing() {
		draft = String(credits);
		editing = false;
	}
</script>

{#if editable}
	<form method="POST" action={editable.action} class="credit-shell" class:compact class:editing>
		{#if editable.targetUserId}
			<input
				type="hidden"
				name={editable.targetUserIdField ?? 'targetUserId'}
				value={editable.targetUserId}
			/>
		{/if}

		{#if showLabel && label}<span class="credit-label">{label}</span>{/if}

		{#if editing}
			<input
				class="credit-input"
				type="number"
				min="0"
				step="1"
				name="credits"
				bind:value={draft}
				aria-label={editable.inputLabel}
			/>
			<div class="credit-actions">
				<button type="submit" class="icon-button" aria-label={editable.saveLabel}>
					<wa-icon name="check" variant="solid"></wa-icon>
				</button>
				<button
					type="button"
					class="icon-button"
					aria-label={editable.cancelLabel}
					onclick={cancelEditing}
				>
					<wa-icon name="xmark" variant="solid"></wa-icon>
				</button>
			</div>
		{:else}
			<div class="credit-display">
				<strong class="credit-value">{credits}</strong>
				{#if unit}<span class="credit-unit">{unit}</span>{/if}
				<button
					type="button"
					class="icon-button"
					aria-label={editable.editLabel}
					onclick={startEditing}
				>
					<wa-icon name="pen-to-square" variant="solid"></wa-icon>
				</button>
			</div>
		{/if}
	</form>
{:else}
	<div class="credit-shell" class:compact>
		{#if showLabel && label}<span class="credit-label">{label}</span>{/if}
		<div class="credit-display">
			<strong class="credit-value">{credits}</strong>
			{#if unit}<span class="credit-unit">{unit}</span>{/if}
		</div>
	</div>
{/if}

<style>
	.credit-shell,
	.credit-display,
	.credit-actions {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		flex-wrap: wrap;
	}

	.credit-shell {
		justify-content: space-between;
	}

	.credit-shell.compact {
		justify-content: flex-start;
		gap: 0.7rem;
		flex-wrap: nowrap;
	}

	.credit-shell.editing.compact {
		flex-wrap: wrap;
	}

	.credit-label,
	.credit-unit {
		color: var(--wa-color-text-quiet);
	}

	.credit-label {
		font-size: 0.95rem;
	}

	.credit-unit {
		font-size: 0.9rem;
	}

	.credit-value {
		font-size: clamp(1.25rem, 4vw, 2rem);
		line-height: 1;
	}

	.compact .credit-value {
		font-size: clamp(1rem, 3vw, 1.35rem);
	}

	.credit-input {
		width: min(8rem, 100%);
		box-sizing: border-box;
		padding: 0.6rem 0.75rem;
		border-radius: 0.6rem;
		border: 1px solid var(--wa-color-surface-border);
		font: inherit;
	}

	.credit-actions {
		flex-wrap: nowrap;
	}

	.icon-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		inline-size: 2.25rem;
		block-size: 2.25rem;
		border: 1px solid var(--wa-color-surface-border);
		border-radius: 999px;
		background: transparent;
		color: var(--wa-color-text-quiet);
		cursor: pointer;
		padding: 0;

		wa-icon {
			font-size: 1rem;
		}
	}

	@media (max-width: 640px) {
		.credit-shell {
			align-items: stretch;
		}

		.credit-display,
		.credit-actions {
			justify-content: flex-start;
		}

		.credit-shell.compact {
			flex-wrap: wrap;
		}
	}
</style>
