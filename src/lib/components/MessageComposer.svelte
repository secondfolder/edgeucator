<script lang="ts">
	import { MAX_ATTACHMENTS_PER_MESSAGE } from '$lib/messaging';
	import { checkComposed } from '$lib/messaging/client';
	import RichTextEditor from './RichTextEditor.svelte';
	import { MESSAGE_FEATURES } from '$lib/richtext-editor';

	/**
	 * Where a message is written. Presentational: it collects a document and
	 * files and hands them up. No crypto, no fetch.
	 *
	 * `send` returns an error string to render, or null on success.
	 *
	 * Formatting has no on-screen controls, deliberately — this is a chat box,
	 * and Messenger does not put a toolbar in one. `*bold*`, `_italic_`,
	 * `~struck~` and Ctrl+B are the whole interface. Descriptions, which live in
	 * forms, get the floating toolbar instead.
	 *
	 * Historical note worth keeping: this component used to attach its `input`
	 * and `keydown` listeners by hand, because `<wa-textarea>` kept its editable
	 * node in a shadow root and Svelte's event delegation does not reliably
	 * cross that boundary — `oninput=` never fired and the send button sat
	 * permanently disabled. The editor mounts on an ordinary `contenteditable`
	 * div, so both workarounds are gone. Do not reintroduce a `wa-textarea`
	 * here without reading that history.
	 */
	let {
		send,
		placeholder = 'Say something…',
		submitLabel = 'Send'
	}: {
		send: (message: { text: string; files: File[] }) => Promise<string | null>;
		placeholder?: string;
		submitLabel?: string;
	} = $props();

	let text = $state('');
	let files: File[] = $state([]);
	let sending = $state(false);
	let problem: string | null = $state(null);
	let fileInput: HTMLInputElement | undefined = $state();
	let editor: ReturnType<typeof RichTextEditor> | undefined = $state();

	const nothingToSend = $derived(
		files.length === 0 && checkComposed({ text, files })?.kind === 'empty'
	);

	function onChange(next: string) {
		text = next;
		if (problem) problem = checkComposed({ text, files })?.message ?? null;
	}

	function onPick(event: Event) {
		const picked = [...((event.target as HTMLInputElement).files ?? [])];
		// Appended rather than replaced, so picking twice adds rather than
		// discards — the file input reports only its own last selection.
		files = [...files, ...picked].slice(0, MAX_ATTACHMENTS_PER_MESSAGE);
		problem = checkComposed({ text, files })?.message ?? null;
		// Cleared so re-picking the same file fires `change` again.
		if (fileInput) fileInput.value = '';
	}

	function remove(index: number) {
		files = files.filter((_, at) => at !== index);
		problem = checkComposed({ text, files })?.message ?? null;
	}

	/**
	 * Sends on a click rather than on a form submit.
	 *
	 * There is no `<form>` here on purpose. Enter is handled by the editor
	 * itself (`onSubmit` below), so a form would contribute nothing but a
	 * second, less reliable path to the same function.
	 */
	async function submit() {
		if (sending || nothingToSend) return;

		const local = checkComposed({ text, files });
		if (local) {
			problem = local.message;
			return;
		}

		sending = true;
		problem = null;
		try {
			const failure = await send({ text, files });
			if (failure) {
				problem = failure;
				return;
			}
			text = '';
			files = [];
			// The editor owns its document, so resetting the state is not enough.
			editor?.setValue('');
		} finally {
			sending = false;
		}
	}

	function sizeOf(bytes: number): string {
		return bytes < 1024 * 1024
			? `${Math.max(1, Math.round(bytes / 1024))} KB`
			: `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	}
</script>

<div class="composer">
	{#if problem}
		<wa-callout variant="danger" size="small">{problem}</wa-callout>
	{/if}

	{#if files.length > 0}
		<ul class="files">
			{#each files as file, index (`${file.name}-${index}`)}
				<li>
					<span class="name">{file.name}</span>
					<span class="size">{sizeOf(file.size)}</span>
					<button type="button" onclick={() => remove(index)} aria-label={`Remove ${file.name}`}>
						×
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	<div class="row">
		<!--
			The attach control and the editor share a positioned `.field` box so the
			button can sit INSIDE the input, at its inline-end and block-end: visually
			centred on a one-line box and pinned to the bottom as the editor grows.
			Text never runs under the button because the editing surface reserves the
			button's width as inline-end padding (below).

			No autofocus, deliberately: the composer appears on a tap, so the user is
			already looking at it.
		-->
		<div class="field">
			<RichTextEditor
				bind:this={editor}
				value=""
				{onChange}
				onSubmit={submit}
				{placeholder}
				features={MESSAGE_FEATURES}
				ariaLabel={placeholder}
				editorClass="composer-input"
			/>

			<label class="attach" aria-label="Attach a photo or video">
				<wa-icon name="image" variant="solid"></wa-icon>
				<input
					bind:this={fileInput}
					type="file"
					accept="image/*,video/*"
					multiple
					onchange={onPick}
				/>
			</label>
		</div>

		<!-- disabled={...}, never `... || undefined` — invariant 11. -->
		<!-- svelte-ignore a11y_click_events_have_key_events,a11y_no_static_element_interactions -->
		<wa-button variant="brand" disabled={sending || nothingToSend} onclick={submit}>
			{#if sending}<wa-spinner></wa-spinner>{:else}{submitLabel}{/if}
		</wa-button>
	</div>
</div>

<style>
	.composer {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.row {
		display: flex;
		align-items: flex-end;
		gap: 0.5rem;

		wa-button {
			/* Stops iOS turning a double tap on the send button into a zoom. */
			touch-action: manipulation;
		}
	}

	.field {
		position: relative;
		flex: 1 1 auto;
		min-inline-size: 0;
		display: flex;

		/* The editor is a plain contenteditable box, so it gets the border and
		   padding `<wa-textarea>` used to draw for us. */
		:global(.composer-input) {
			flex: 1 1 auto;
			min-inline-size: 0;
			max-block-size: 40svh;
			overflow-y: auto;
			padding: 0.5rem 2.375rem 0.5rem 0.75rem;
			border: 1px solid var(--wa-color-surface-border);
			border-radius: 1rem;
			background: var(--wa-color-surface-lowered, transparent);
		}

		:global(.composer-input:focus-within) {
			outline: 2px solid var(--wa-color-brand-fill-loud, currentColor);
			outline-offset: -1px;
		}
	}

	.attach {
		/* Inside `.field`'s box, over the textarea: bottom-anchored, so it is
		   vertically centred on a one-line box and stays at the bottom as the
		   textarea grows. 2rem + 2×0.25rem fits inside a one-line control. */
		position: absolute;
		inset-block-end: 0.3rem;
		inset-inline-end: 0.3rem;
		display: grid;
		place-items: center;
		inline-size: 2rem;
		block-size: 2rem;
		border-radius: 50%;
		cursor: pointer;
		color: var(--wa-color-text-quiet);

		&:focus-within {
			outline: 2px solid var(--wa-color-brand-fill-loud, currentColor);
			outline-offset: 2px;
		}

		input {
			position: absolute;
			clip-path: inset(50%);
			inline-size: 1px;
			block-size: 1px;
		}
	}

	.files {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;

		li {
			display: flex;
			align-items: center;
			gap: 0.5rem;
			font-size: 0.8125rem;

			.name {
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			.size {
				color: var(--wa-color-text-quiet);
				margin-inline-start: auto;
			}

			button {
				border: none;
				background: none;
				cursor: pointer;
				font-size: 1.125rem;
				line-height: 1;
				color: var(--wa-color-text-quiet);
				padding: 0 0.25rem;
			}
		}
	}
</style>
