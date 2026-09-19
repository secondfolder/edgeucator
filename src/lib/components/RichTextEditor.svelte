<script lang="ts">
	import { untrack } from 'svelte';
	import {
		$createParagraphNode as createParagraphNode,
		$getRoot as getRoot,
		$getSelection as getSelection,
		$isRangeSelection as isRangeSelection,
		BLUR_COMMAND,
		COMMAND_PRIORITY_LOW,
		KEY_ENTER_COMMAND,
		type LexicalEditor
	} from 'lexical';
	import { $isAutoLinkNode as isAutoLinkNode } from '@lexical/link';
	import { $findMatchingParent as findMatchingParent } from '@lexical/utils';
	import FloatingFormatToolbar from './FloatingFormatToolbar.svelte';
	import {
		$autoLinksAwaitingEmbeds as autoLinksAwaitingEmbeds,
		$insertEmbedForLink as insertEmbedForLink,
		MESSAGE_FEATURES,
		createRichTextEditor,
		type RichTextEditorHandle,
		type RichTextFeature
	} from '$lib/richtext-editor';
	import { parseStoredRichText, richTextDocumentSchema } from '$lib/richtext';

	/**
	 * The one editor, in both of its moods.
	 *
	 * Messages get no toolbar at all — formatting is typed (`*bold*`, `_italic_`)
	 * or keyed (Ctrl+B), the way Messenger does it. Descriptions get a floating
	 * toolbar on a selection, because a form field is a place people expect
	 * controls.
	 *
	 * `value` is the **stored string** and `onChange` hands back a stored string,
	 * so callers never see a Lexical type. Legacy plain text is accepted and
	 * silently becomes a document the moment it is saved.
	 *
	 * **`value` is the initial value only.** The editor owns its content from
	 * then on, like an uncontrolled input; to replace it from outside, call
	 * `setValue()`. That is deliberate, and it is what makes typing work:
	 * `TaskForm` feeds `onChange` straight back into `value` through superforms,
	 * and superforms propagates a store write asynchronously. A component that
	 * reloaded whenever `value` changed would therefore keep seeing a *stale*
	 * value arrive mid-keystroke and load it over what had just been typed —
	 * which is exactly the bug this shape exists to prevent. Reloading on every
	 * change also destroys the caret and any selection.
	 */
	let {
		/** Initial content only — see the note above. Use `setValue()` after mount. */
		value = '',
		onChange,
		onSubmit = undefined,
		placeholder = '',
		features = MESSAGE_FEATURES,
		toolbar = false,
		ariaLabel = undefined,
		editorClass = ''
	}: {
		value?: string;
		onChange: (stored: string) => void;
		/** Set for the composer: Enter sends, Shift+Enter breaks the line. */
		onSubmit?: (() => void) | undefined;
		placeholder?: string;
		features?: readonly RichTextFeature[];
		toolbar?: boolean;
		ariaLabel?: string | undefined;
		editorClass?: string;
	} = $props();

	let root: HTMLDivElement | undefined = $state();
	let handle: RichTextEditorHandle | null = $state(null);
	let isEmpty = $state(true);

	/**
	 * The value the editor and its parent already agree on.
	 *
	 * Set when content is loaded in, and again whenever the editor emits. The
	 * sync effect below reloads only when `value` differs from this, which is
	 * what stops a parent echoing a change back from wiping the caret — and
	 * what stops the initial load running a second time and eating whatever was
	 * typed in the moment before effects settled.
	 */
	let agreedValue: string | null = null;

	function serialise(editor: LexicalEditor): string {
		const full = editor.getEditorState().toJSON();
		/**
		 * The stored form is the *validated* form — the same schema the server
		 * applies to descriptions. It drops Lexical's default-valued noise
		 * (`detail`, `mode`, `style`, `version`, …), which is roughly half the
		 * bytes, and it drops node state, which is the sanitisation step.
		 *
		 * If it ever fails to validate the editor has produced something outside
		 * the closed node set — a bug, but never one worth losing a message
		 * over, so the full form is stored instead. It reads back fine; it is
		 * just bigger.
		 */
		const checked = richTextDocumentSchema.safeParse(full);
		if (!checked.success) {
			console.error('[richtext] editor produced an unexpected document', checked.error);
			return JSON.stringify(full);
		}
		return JSON.stringify(checked.data);
	}

	function load(editor: LexicalEditor, stored: string) {
		const doc = parseStoredRichText(stored);
		if (doc.root.children.length === 0) {
			// Lexical refuses a state whose root has no children ("the editor state
			// is empty"), and an empty field is the commonest case there is — a
			// fresh add form. One empty paragraph is what an empty editor means.
			editor.update(
				() => {
					getRoot().clear().append(createParagraphNode());
				},
				{ discrete: true }
			);
			return;
		}
		editor.setEditorState(editor.parseEditorState(JSON.stringify(doc)));
	}

	$effect(() => {
		const element = root;
		if (!element) return;

		const created = createRichTextEditor({ features, namespace: 'bound-up-richtext' });
		const { editor } = created;
		handle = created;
		editor.setRootElement(element);

		/**
		 * `value` is read untracked, and that is load-bearing.
		 *
		 * This effect *builds* the editor. If it depended on `value` it would
		 * tear the editor down and build a new one every time the prop changed —
		 * and `TaskForm` feeds `onChange` straight back into `value` through
		 * superforms, so that is once per keystroke. The caret went back to the
		 * start each time, so characters landed in reverse order and a selection
		 * was dropped the instant it was made.
		 *
		 * A later value from outside is handled by the separate effect below,
		 * which reloads the *content* without rebuilding the editor. This is the
		 * same class of bug AGENTS.md records for effects that read the `data`
		 * prop, and the same fix: do not let a setup effect depend on something
		 * that changes constantly.
		 */
		const initial = untrack(() => value);
		load(editor, initial);
		// Recorded so the sync effect below treats the mount as already settled
		// rather than loading the same content again a moment later.
		agreedValue = initial;
		// Legacy content arrives with its embeds already worked out; anything
		// pasted in later gets them from the selection watcher below.
		isEmpty = stored(editor).length === 0;

		/**
		 * Embeds appear above the paragraph of any finished auto-link.
		 *
		 * "Finished" means the caret is not inside it: typing a URL shows no
		 * embed until you move off, so nothing pops up mid-word. Every *other*
		 * embeddable link gets one straight away, which is what makes a pasted
		 * block of text — or several URLs entered at once — come out with all of
		 * its embeds rather than just the last.
		 *
		 * `registerAutoLink` works through node transforms that run after the
		 * update callback returns, so the links only exist to be noticed on a
		 * later tick. That is why this hangs off the update listener rather than
		 * off the keystroke that produced them.
		 */
		let settling = false;

		const caretLinkKey = (): string | null => {
			const selection = getSelection();
			if (!isRangeSelection(selection)) return null;
			return findMatchingParent(selection.anchor.getNode(), isAutoLinkNode)?.getKey() ?? null;
		};

		const sweepEmbeds = (ignoreCaret = false) => {
			if (settling) return;
			let work = false;
			editor.getEditorState().read(() => {
				work = autoLinksAwaitingEmbeds(ignoreCaret ? null : caretLinkKey()).length > 0;
			});
			if (!work) return;
			// Guarded because this runs *from* an update listener, and an
			// unguarded update from there is an infinite loop.
			settling = true;
			editor.update(
				() => {
					for (const link of autoLinksAwaitingEmbeds(ignoreCaret ? null : caretLinkKey())) {
						insertEmbedForLink(link);
					}
				},
				{ onUpdate: () => (settling = false) }
			);
		};

		const offUpdate = editor.registerUpdateListener(({ editorState }) => {
			sweepEmbeds();

			const next = serialise(editor);
			editorState.read(() => {
				isEmpty = getRoot().getTextContent().trim().length === 0;
			});
			if (next === agreedValue) return;
			agreedValue = next;
			onChange(next);
		});

		// Leaving the field entirely counts as moving off the link too — the case
		// where someone types a URL and immediately clicks Send.
		const offBlur = editor.registerCommand(
			BLUR_COMMAND,
			() => {
				sweepEmbeds(true);
				return false;
			},
			COMMAND_PRIORITY_LOW
		);

		const offEnter = onSubmit
			? editor.registerCommand(
					KEY_ENTER_COMMAND,
					(event) => {
						if (!event || event.shiftKey) return false;
						event.preventDefault();
						// Anything typed right up to Enter still deserves its embed.
						sweepEmbeds(true);
						onSubmit();
						return true;
					},
					COMMAND_PRIORITY_LOW
				)
			: () => {};

		return () => {
			offUpdate();
			offBlur();
			offEnter();
			editor.setRootElement(null);
			created.destroy();
			handle = null;
		};
	});

	/**
	 * Accepts a value that genuinely came from outside — a form reset, a
	 * different task loaded into the same form.
	 *
	 * Skips the value the editor itself just produced, which is what the parent
	 * echoes back on every change. Reloading on an echo would throw away the
	 * caret for no gain, because the content is already exactly that.
	 */
	$effect(() => {
		const next = value;
		const editor = handle?.editor;
		if (!editor || next === agreedValue) return;
		// Marked before loading so the emission this triggers is recognised as
		// ours and does not bounce back through the parent.
		agreedValue = next;
		untrack(() => load(editor, next));
	});

	function stored(editor: LexicalEditor): string {
		let out = '';
		editor.getEditorState().read(() => {
			out = getRoot().getTextContent().trim();
		});
		return out;
	}

	/** Replace the contents from outside — used to clear the composer on send. */
	export function setValue(next: string) {
		const editor = handle?.editor;
		if (!editor) return;
		load(editor, next);
		agreedValue = next;
	}

	export function focus() {
		handle?.editor.focus();
	}
</script>

<div class="richtext-editor {editorClass}">
	<!--
		`contenteditable` is switched on only once Lexical has attached.

		The markup is server-rendered, so a statically editable div is typeable
		during the window between hydration and the effect that builds the
		editor. Anything typed in that window goes straight into the DOM, and
		Lexical wipes it on attach — which presented as the first few characters
		vanishing when you clicked and typed immediately after a page load.
	-->
	<div
		bind:this={root}
		class="surface"
		contenteditable={handle !== null}
		role="textbox"
		aria-multiline="true"
		aria-label={ariaLabel ?? placeholder}
		spellcheck="true"
	></div>
	{#if isEmpty && placeholder}
		<div class="placeholder" aria-hidden="true">{placeholder}</div>
	{/if}
	{#if toolbar && handle}
		<FloatingFormatToolbar editor={handle.editor} {features} />
	{/if}
</div>

<style>
	.richtext-editor {
		position: relative;
		display: grid;
	}

	.surface {
		grid-area: 1 / 1;
		min-inline-size: 0;
		outline: none;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.placeholder {
		grid-area: 1 / 1;
		pointer-events: none;
		color: var(--wa-color-text-quiet);
	}

	/* Lexical owns the markup inside `.surface`, so these have to be global —
	   scoped CSS only reaches elements this component's template declares. */
	.surface :global(p),
	.surface :global(ul),
	.surface :global(ol) {
		margin: 0;
	}

	.surface :global(p + p) {
		margin-block-start: 0.5em;
	}

	.surface :global(ul),
	.surface :global(ol) {
		padding-inline-start: 1.5em;
	}

	.surface :global(a) {
		color: inherit;
		text-decoration: underline;
	}

	/* The formats Lexical cannot express through its one tag per text node —
	   see the theme in `richtext-editor.ts`. These have to say out loud what
	   `<strong>` and `<em>` say for free, because a node that is bold *and*
	   italic gets `<strong>` only, and a struck one gets a bare `<span>`.

	   Kept in step with `MarkedText.svelte`, which wraps the same bits in real
	   elements for the read-only view: what you see while writing is what the
	   reader gets. */
	.surface :global(.rt-bold) {
		font-weight: bold;
	}

	.surface :global(.rt-italic) {
		font-style: italic;
	}

	.surface :global(.rt-strikethrough) {
		text-decoration: line-through;
	}

	/* The composer's stand-in for an embed: a quiet chip, not a live player.
	   Nobody wants a video autoplaying while they are still writing. */
	.surface :global(.richtext-embed-chip) {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		max-inline-size: 100%;
		margin-block: 0.35rem;
		padding: 0.25rem 0.6rem;
		border: 1px solid var(--wa-color-surface-border);
		border-radius: 999px;
		background: var(--wa-color-neutral-fill-quiet, rgb(0 0 0 / 6%));
		font-size: 0.8125rem;
		user-select: none;
	}

	.surface :global(.richtext-embed-chip__icon) {
		font-size: 0.7em;
		opacity: 0.7;
	}

	.surface :global(.richtext-embed-chip__label) {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
