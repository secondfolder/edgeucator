<script lang="ts">
	import type { TagView } from '$lib/types';

	let {
		partnershipId,
		tags,
		selectedIds = $bindable<string[]>([]),
		threadId,
		startEditing = false
	}: {
		partnershipId: string;
		tags: TagView[];
		selectedIds?: string[];
		threadId?: string;
		startEditing?: boolean;
	} = $props();

	// The picker owns this editable list after initial load; re-capturing it on
	// every invalidation would overwrite an in-progress rename or new selection.
	// svelte-ignore state_referenced_locally
	let localTags = $state<TagView[]>([...tags]);
	// A seed for the initial mode, not a live dependency — the dialog wants the
	// editor open on a fresh compose, and the thread view starts in display mode.
	// svelte-ignore state_referenced_locally
	let editing = $state(startEditing);
	let newName = $state('');
	let newColor = $state('#5d7fc2');
	let addingNew = $state(false);
	let editingTagId = $state<string | null>(null);
	let draftName = $state('');
	let draftColor = $state('#5d7fc2');
	let problem = $state<string | null>(null);
	let saving = $state(false);
	// What Cancel restores: the selection as last saved (or as loaded). Snapshotted
	// rather than derived, because the whole point is to discard live edits.
	let savedIds = $state<string[]>([...selectedIds]);

	const selectedTags = $derived(
		selectedIds
			.map((id) => localTags.find((tag) => tag.id === id))
			.filter((tag): tag is TagView => Boolean(tag))
	);

	/** The option that opens the inline new-tag field. */
	const NEW_TAG_VALUE = '__new__';

	/** Only tags not yet on the thread appear in the dropdown. */
	const addableTags = $derived(localTags.filter((tag) => !selectedIds.includes(tag.id)));

	function onAddTagSelect(event: CustomEvent) {
		const item = (event.detail as { item?: { value?: string } }).item;
		const value = item?.value;
		if (!value) return;
		if (value === NEW_TAG_VALUE) {
			addingNew = true;
			problem = null;
			return;
		}
		selectedIds = [...selectedIds, value];
		problem = null;
	}

	async function addTag() {
		if (!newName.trim()) return;
		const response = await fetch(`/api/partnerships/${partnershipId}/tags`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name: newName, color: newColor })
		});
		if (!response.ok) {
			problem = 'Could not add that tag';
			return;
		}
		const tag = (await response.json()) as TagView;
		localTags = [...localTags, tag].sort((left, right) => left.name.localeCompare(right.name));
		selectedIds = [...selectedIds, tag.id];
		newName = '';
		newColor = '#5d7fc2';
		addingNew = false;
		problem = null;
	}

	function beginEdit(tag: TagView) {
		editingTagId = tag.id;
		draftName = tag.name;
		draftColor = tag.color;
		problem = null;
	}

	async function saveEdit() {
		if (!editingTagId) return;
		const response = await fetch(`/api/partnerships/${partnershipId}/tags/${editingTagId}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name: draftName, color: draftColor })
		});
		if (!response.ok) {
			problem = 'Could not save that tag';
			return;
		}
		const updated = (await response.json()) as TagView;
		localTags = localTags.map((tag) => (tag.id === updated.id ? updated : tag));
		editingTagId = null;
		problem = null;
	}

	/** The only removal path while editing: inside the pencil's edit options. */
	function removeEditing() {
		if (!editingTagId) return;
		selectedIds = selectedIds.filter((value) => value !== editingTagId);
		editingTagId = null;
	}

	/** Persists the selection, then returns to display mode. */
	async function save() {
		if (threadId) {
			saving = true;
			const response = await fetch(`/api/partnerships/${partnershipId}/threads/${threadId}/tags`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ tagIds: selectedIds })
			});
			saving = false;
			if (!response.ok) {
				problem = 'Could not update tags';
				return;
			}
		}
		savedIds = [...selectedIds];
		editing = false;
		problem = null;
	}

	/** Discards every in-flight edit and restores the last saved selection. */
	function cancel() {
		selectedIds = [...savedIds];
		editingTagId = null;
		addingNew = false;
		newName = '';
		editing = false;
		problem = null;
	}
</script>

{#if editing}
	<!-- Everything on one wrapping line: chips, the Add tag dropdown, any
	     in-progress field, and Done. No stacked sections. -->
	<div class="tag-picker editing" role="group" aria-label="Edit tags">
		{#each selectedTags as tag (tag.id)}
			<!-- The pill stays; only its contents are swapped for the edit controls. -->
			<span class="tag" style={`--tag-color: ${tag.color}`}>
				{#if editingTagId === tag.id}
					<span class="field-row">
						<input aria-label="Tag name" bind:value={draftName} maxlength="80" />
						<label class="colour" style={`background: ${draftColor}`}>
							<wa-icon name="paintbrush" variant="solid"></wa-icon>
							<input aria-label="Tag colour" type="color" bind:value={draftColor} />
						</label>
						<button type="button" aria-label="Save tag" onclick={saveEdit}>
							<wa-icon name="check" variant="solid"></wa-icon>
						</button>
						<button type="button" class="remove" aria-label="Remove tag" onclick={removeEditing}>
							<wa-icon name="trash" variant="solid"></wa-icon>
						</button>
					</span>
				{:else}
					<span class="swatch" style={`background: ${tag.color}`}></span>
					{tag.name}
					<button
						type="button"
						class="mini"
						aria-label={`Edit ${tag.name}`}
						onclick={() => beginEdit(tag)}
					>
						<wa-icon name="pencil" variant="solid"></wa-icon>
					</button>
				{/if}
			</span>
		{/each}

		<wa-dropdown onwa-select={onAddTagSelect}>
			<wa-button slot="trigger" size="s" with-caret>Add tag</wa-button>
			{#each addableTags as tag (tag.id)}
				<wa-dropdown-item value={tag.id}>
					<span class="swatch" slot="icon" style={`background: ${tag.color}`}></span>
					{tag.name}
				</wa-dropdown-item>
			{/each}
			{#if addableTags.length > 0}
				<wa-divider></wa-divider>
			{/if}
			<wa-dropdown-item value={NEW_TAG_VALUE}>
				<wa-icon slot="icon" name="plus" variant="solid"></wa-icon>
				New tag
			</wa-dropdown-item>
		</wa-dropdown>

		{#if addingNew}
			<!-- The new-tag field lives in a pill of its own, previewing the chosen
			     colour, so it reads as "a tag being born" rather than a loose form. -->
			<span class="tag" style={`--tag-color: ${newColor}`}>
				<span class="field-row">
					<input aria-label="New tag" placeholder="Tag name" bind:value={newName} maxlength="80" />
					<label class="colour" style={`background: ${newColor}`}>
						<wa-icon name="paintbrush" variant="solid"></wa-icon>
						<input aria-label="New tag colour" type="color" bind:value={newColor} />
					</label>
					<button type="button" onclick={addTag}>Add</button>
				</span>
			</span>
		{/if}

		{#if threadId}
			<!-- svelte-ignore a11y_click_events_have_key_events,a11y_no_static_element_interactions -->
			<wa-button size="s" variant="brand" appearance="filled" disabled={saving} onclick={save}>
				Save
			</wa-button>
			<!-- svelte-ignore a11y_click_events_have_key_events,a11y_no_static_element_interactions -->
			<wa-button size="s" appearance="plain" disabled={saving} onclick={cancel}>Cancel</wa-button>
		{/if}

		{#if problem}<p class="problem">{problem}</p>{/if}
	</div>
{:else if selectedTags.length > 0}
	<div class="tag-picker display">
		{#each selectedTags as tag (tag.id)}
			<span class="tag" style={`--tag-color: ${tag.color}`}>{tag.name}</span>
		{/each}
		<button
			type="button"
			class="mini standalone"
			aria-label="Edit tags"
			onclick={() => (editing = true)}
		>
			<wa-icon name="pencil" variant="solid"></wa-icon>
		</button>
	</div>
{:else}
	<div class="tag-picker display">
		<button type="button" class="add-tags" onclick={() => (editing = true)}>Add tags</button>
	</div>
{/if}

<style>
	.tag-picker {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.tag-picker.display,
	.tag-picker.editing {
		flex-direction: row;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem;
	}

	.tag {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.2rem 0.5rem;
		border-radius: 999px;
		background: color-mix(
			in srgb,
			var(--tag-color, #5d7fc2) 18%,
			var(--wa-color-surface-default, white)
		);
		border: 1px solid color-mix(in srgb, var(--tag-color, #5d7fc2) 55%, transparent);
		color: var(--wa-color-text-normal, #17202a);
		font-size: 0.75rem;
		line-height: 1.2;
		overflow-wrap: anywhere;
	}

	.swatch {
		inline-size: 0.6rem;
		block-size: 0.6rem;
		border-radius: 50%;
		flex: none;
	}

	button {
		font: inherit;
		cursor: pointer;
	}

	.mini {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0 0.3rem;
		border: 0;
		background: transparent;
		/* Inside a chip, so it inherits the chip's readable foreground. */
		color: inherit;
		font-size: 0.75rem;
		line-height: 1;

		&.standalone {
			padding: 0.25rem 0.35rem;
			border: 1px solid var(--wa-color-surface-border);
			border-radius: 999px;
			background: var(--wa-color-surface-default, white);
			color: var(--wa-color-text-normal, #17202a);
		}
	}

	.add-tags {
		padding: 0.2rem 0.55rem;
		border: 1px solid var(--wa-color-surface-border);
		border-radius: 999px;
		background: var(--wa-color-surface-default, white);
		color: var(--wa-color-text-normal, #17202a);
		font-size: 0.75rem;
	}

	.field-row {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;

		/* Inside a chip the controls must fit the pill, not stretch it sideways. */
		.tag & {
			gap: 0.2rem;

			input:not([type='color']) {
				min-inline-size: 4.5rem;
				padding: 0.1rem 0.35rem;
				font-size: 0.75rem;
			}

			.colour {
				inline-size: 2.6em;
				block-size: 2.6em;
				flex: 0 0 auto;
			}

			button {
				padding: 0.15rem 0.35rem;
				font-size: 0.75rem;
			}
		}

		input:not([type='color']) {
			min-inline-size: 7rem;
			padding: 0.3rem 0.5rem;
			border: 1px solid var(--wa-color-surface-border);
			border-radius: 0.35rem;
			background: var(--wa-color-surface-default, white);
			color: var(--wa-color-text-normal, #17202a);
		}

		button {
			padding: 0.3rem 0.6rem;
			border: 1px solid var(--wa-color-surface-border);
			border-radius: 0.35rem;
			background: var(--wa-color-surface-default, white);
			color: var(--wa-color-text-normal, #17202a);

			&.remove {
				color: var(--wa-color-danger-text, #a52a2a);
			}
		}
	}

	/*
	 * The colour control shows the chosen colour AS the field, with a brush icon
	 * on top. The native input is invisible but fills the label, so the whole
	 * swatch is the click target for the browser's colour picker.
	 */
	.colour {
		position: relative;
		display: inline-grid;
		place-items: center;
		block-size: 1.7rem;
		border: 1px solid var(--wa-color-surface-border);
		border-radius: 0.35rem;
		cursor: pointer;
		/* The icon has to read over any hue, light or dark. */
		color: white;

		wa-icon {
			pointer-events: none;
			filter: drop-shadow(0 0 0.125rem rgb(0 0 0 / 60%));
			font-size: 0.85rem;
		}

		input[type='color'] {
			position: absolute;
			inset: 0;
			opacity: 0;
			cursor: pointer;
		}
	}

	.problem {
		margin: 0;
		color: var(--wa-color-danger-text, #a52a2a);
		font-size: 0.8rem;
	}
</style>
