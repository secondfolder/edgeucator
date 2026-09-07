<script lang="ts">
	import { MAX_ATTACHMENTS_PER_MESSAGE, MAX_BODY_CHARS } from '$lib/messaging';
	import { checkComposed } from '$lib/messaging/client';

	/**
	 * Where a message is written. Presentational: it collects text and files and
	 * hands them up. No crypto, no fetch.
	 *
	 * `send` returns an error string to render, or null on success.
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
	let textarea: HTMLElement | undefined = $state();

	/**
	 * The input listener is attached by hand rather than with `oninput=`.
	 *
	 * Svelte 5 *delegates* known DOM events — one listener at the root, dispatched
	 * by walking up from the event's target — and that walk does not reliably
	 * cross a custom element's shadow boundary. `<wa-textarea>`'s editable node
	 * lives in a shadow root, so `oninput=` on the host never fired and `text`
	 * stayed empty: the send button sat permanently disabled and typing appeared
	 * to do nothing at all.
	 *
	 * `addEventListener` is not delegated, so it sees the composed event with
	 * `target` retargeted to the host — which is where `.value` lives.
	 *
	 * Worth knowing that `InputField.svelte` has the same `oninput=` shape and
	 * has never visibly broken. It gets away with it because `<wa-input>` is
	 * form-associated and contributes its own value to the FormData, so nothing
	 * there depends on the Svelte state actually updating. This component does.
	 */
	$effect(() => {
		const element = textarea;
		if (!element) return;
		const onInput = () => {
			text = (element as unknown as { value?: string }).value ?? '';
			if (problem) problem = checkComposed({ text, files })?.message ?? null;
		};
		element.addEventListener('input', onInput);
		return () => element.removeEventListener('input', onInput);
	});

	const nothingToSend = $derived(text.trim().length === 0 && files.length === 0);

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
	 * There is no `<form>` here on purpose. A textarea does not submit on Enter
	 * anyway (and should not — see the note by the textarea), so a form would
	 * contribute nothing but a second, less reliable path to the same function:
	 * `<wa-button type="submit">` submits by finding its form and calling
	 * `requestSubmit`, which depends on the element having upgraded and on the
	 * form association working, and neither is worth depending on for a control
	 * that already has a click handler.
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
			// The element owns its value, so resetting the state is not enough.
			if (textarea) (textarea as unknown as { value: string }).value = '';
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
			Enter inserts a newline and the button sends: a sext is multi-line
			prose more often than it is a chat line, so Enter-to-send would cut
			people off mid-thought.
		-->
		<!--
			`value` is set only as the initial/reset value; the element owns it from
			then on — see the effect above for why the handler is imperative.

			No `autofocus`, deliberately. `<wa-textarea autofocus>` reaches for its
			inner textarea before the shadow root exists and throws "Cannot read
			properties of null (reading 'focus')". An uncaught error there stops
			Svelte wiring up the rest of the component, so the whole composer went
			dead — which presented as the send button never enabling, nowhere near
			the actual cause.
		-->
		<wa-textarea
			bind:this={textarea}
			name="text"
			label={placeholder}
			{placeholder}
			resize="auto"
			rows="1"
			maxlength={MAX_BODY_CHARS}
			value={text}
		></wa-textarea>

		<label class="attach" aria-label="Attach a photo or video">
			<wa-icon name="paperclip" variant="solid"></wa-icon>
			<input
				bind:this={fileInput}
				type="file"
				accept="image/*,video/*"
				multiple
				onchange={onPick}
			/>
		</label>

		<!-- disabled={...}, never `... || undefined` — invariant 11. -->
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

		wa-textarea {
			flex: 1 1 auto;
			min-inline-size: 0;
		}

		wa-button {
			/* Stops iOS turning a double tap on the send button into a zoom. */
			touch-action: manipulation;
		}
	}

	.attach {
		display: grid;
		place-items: center;
		inline-size: 2.5rem;
		block-size: 2.5rem;
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
