<script lang="ts">
	import type { TagView } from '$lib/types';

	let {
		partnershipId,
		tags,
		selectedIds = $bindable<string[]>([]),
		threadId
	}: {
		partnershipId: string;
		tags: TagView[];
		selectedIds?: string[];
		threadId?: string;
	} = $props();

	// The picker owns this editable list after initial load; re-capturing it on
	// every invalidation would overwrite an in-progress rename or new selection.
	// svelte-ignore state_referenced_locally
	let localTags = $state<TagView[]>([...tags]);
	let newName = $state('');
	let adding = $state(false);
	let editingId = $state<string | null>(null);
	let draftName = $state('');
	let draftColor = $state('#5d7fc2');
	let problem = $state<string | null>(null);

	function toggle(id: string) {
		selectedIds = selectedIds.includes(id)
			? selectedIds.filter((value) => value !== id)
			: [...selectedIds, id];
		if (threadId) void saveSelection();
	}

	async function saveSelection() {
		const response = await fetch(`/api/partnerships/${partnershipId}/threads/${threadId}/tags`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ tagIds: selectedIds })
		});
		if (!response.ok) problem = 'Could not update tags';
	}

	async function addTag() {
		if (!newName.trim()) return;
		const response = await fetch(`/api/partnerships/${partnershipId}/tags`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name: newName })
		});
		if (!response.ok) {
			problem = await response.text();
			return;
		}
		const tag = (await response.json()) as TagView;
		localTags = [...localTags, tag].sort((left, right) => left.name.localeCompare(right.name));
		selectedIds = [...selectedIds, tag.id];
		newName = '';
		adding = false;
		problem = null;
		if (threadId) await saveSelection();
	}

	function beginEdit(tag: TagView) {
		editingId = tag.id;
		draftName = tag.name;
		draftColor = tag.color;
		problem = null;
	}

	async function saveEdit() {
		if (!editingId) return;
		const response = await fetch(`/api/partnerships/${partnershipId}/tags/${editingId}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name: draftName, color: draftColor })
		});
		if (!response.ok) {
			problem = await response.text();
			return;
		}
		const updated = (await response.json()) as TagView;
		localTags = localTags.map((tag) => (tag.id === updated.id ? updated : tag));
		editingId = null;
		problem = null;
	}
</script>

<div class="tag-picker">
	<div class="tags" aria-label="Tags">
		{#each localTags as tag (tag.id)}
			<div class="tag-row">
				<button
					type="button"
					class:chosen={selectedIds.includes(tag.id)}
					class="tag"
					onclick={() => toggle(tag.id)}
				>
					<span class="swatch" style={`background: ${tag.color}`}></span>
					<span>{tag.name}</span>
				</button>
				<button
					type="button"
					class="edit"
					aria-label={`Edit ${tag.name}`}
					onclick={() => beginEdit(tag)}
				>
					<wa-icon name="pencil" variant="solid"></wa-icon>
				</button>
			</div>
			{#if editingId === tag.id}
				<div class="editor">
					<input aria-label="Tag name" bind:value={draftName} maxlength="80" />
					<input aria-label="Tag colour" type="color" bind:value={draftColor} />
					<button type="button" onclick={saveEdit}>Save</button>
				</div>
			{/if}
		{/each}
		{#if adding}
			<div class="new-tag">
				<input aria-label="New tag" placeholder="Tag name" bind:value={newName} maxlength="80" />
				<button type="button" onclick={addTag}>Add</button>
			</div>
		{:else}
			<button type="button" class="add-tag" onclick={() => (adding = true)}>Add tag</button>
		{/if}
	</div>
	{#if problem}<p class="problem">{problem}</p>{/if}
</div>

<style>
	.tag-picker {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.tags,
	.new-tag,
	.editor {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.tag-row {
		display: flex;
		align-items: stretch;
	}

	button,
	input {
		font: inherit;
	}

	.tag,
	.edit,
	.add-tag,
	.new-tag button,
	.editor button {
		border: 1px solid var(--wa-color-surface-border);
		background: var(--wa-color-surface-default, white);
		color: var(--wa-color-text-normal);
		cursor: pointer;
	}

	.tag {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.3rem 0.55rem;
		border-radius: 999px 0 0 999px;
	}

	.tag.chosen {
		box-shadow: inset 0 0 0 2px var(--wa-color-brand-fill-loud, currentColor);
	}

	.swatch {
		inline-size: 0.7rem;
		block-size: 0.7rem;
		border-radius: 50%;
	}

	.edit {
		padding-inline: 0.45rem;
		border-inline-start: 0;
		border-radius: 0 999px 999px 0;
	}

	.add-tag {
		padding: 0.3rem 0.65rem;
		border-radius: 999px;
	}

	.new-tag input,
	.editor input[aria-label='Tag name'] {
		min-inline-size: 8rem;
		padding: 0.35rem 0.5rem;
		border: 1px solid var(--wa-color-surface-border);
		border-radius: 0.35rem;
		background: var(--wa-color-surface-default, white);
		color: var(--wa-color-text-normal, #17202a);
	}

	.new-tag {
		flex-wrap: nowrap;
		align-items: center;
	}

	.new-tag button,
	.editor button {
		padding: 0.35rem 0.65rem;
		border-radius: 0.35rem;
	}

	.editor {
		align-items: center;
		inline-size: 100%;
	}

	.problem {
		margin: 0;
		color: var(--wa-color-danger-text, #a52a2a);
		font-size: 0.8rem;
	}
</style>
