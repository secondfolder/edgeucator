<script lang="ts">
	type RewardFormValues = {
		title: string;
		description: string;
		cost: string | number;
		active: boolean;
	};

	let {
		values,
		submitLabel
	}: {
		values: RewardFormValues;
		submitLabel: string;
	} = $props();
</script>

<form method="POST" class="panel reward-form add-form">
	<label>
		<span>Title</span>
		<input name="title" maxlength="80" required value={values.title} />
	</label>
	<label>
		<span>Description</span>
		<textarea name="description" rows="3" maxlength="500">{values.description}</textarea>
	</label>
	<div class="editor-row">
		<label>
			<span>Cost</span>
			<input type="number" min="0" step="1" name="cost" required value={values.cost} />
		</label>
		<label class="checkbox">
			<input type="checkbox" name="active" checked={values.active} />
			<span>Active</span>
		</label>
	</div>
	<wa-button type="submit">{submitLabel}</wa-button>
</form>

<style>
	.panel {
		border: 1px solid var(--wa-color-surface-border);
		border-radius: var(--wa-panel-border-radius);
		padding: var(--wa-space-l);
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.editor-row {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
	}

	input,
	textarea {
		width: 100%;
		box-sizing: border-box;
		padding: 0.6rem 0.75rem;
		border-radius: 0.6rem;
		border: 1px solid var(--wa-color-surface-border);
		font: inherit;
	}

	textarea {
		resize: vertical;
	}

	.checkbox {
		flex-direction: row;
		align-items: center;

		input {
			width: auto;
		}
	}
</style>
