<script lang="ts">
	import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom';
	import {
		$getSelection as getSelection,
		$isRangeSelection as isRangeSelection,
		COMMAND_PRIORITY_LOW,
		FORMAT_TEXT_COMMAND,
		SELECTION_CHANGE_COMMAND,
		type LexicalEditor,
		type TextFormatType
	} from 'lexical';
	import {
		INSERT_ORDERED_LIST_COMMAND,
		INSERT_UNORDERED_LIST_COMMAND,
		REMOVE_LIST_COMMAND,
		$isListNode as isListNode
	} from '@lexical/list';
	import { $isLinkNode as isLinkNode, $toggleLink as toggleLink } from '@lexical/link';
	import { $findMatchingParent as findMatchingParent } from '@lexical/utils';
	import { isSafeHttpUrl } from '$lib/embeds';
	import type { RichTextFeature } from '$lib/richtext-editor';

	/**
	 * The formatting bar that appears over a selection.
	 *
	 * Description fields get this; messages deliberately do not. Lexical ships no
	 * vanilla floating toolbar — the one in its playground is React — so the
	 * behaviour here follows that plugin, and the placement is Floating UI's
	 * rather than hand-rolled arithmetic.
	 *
	 * Three things this has to get right, each of which was a real bug:
	 *
	 * 1. **It must not sit under the pointer.** A toolbar drawn on top of the
	 *    text it describes catches the second click of a double-click — which is
	 *    how most people select a word — and the text silently gains whatever
	 *    format that button applies. Floating UI's `flip` and `shift` keep it
	 *    clear of the selection and inside the viewport.
	 * 2. **It must not be positioned against the editor.** The field is a
	 *    bordered box with `overflow-y: auto`, so a toolbar inside it is clipped
	 *    and adds its own height to what that box scrolls. It is moved to
	 *    `document.body` and positioned in the `fixed` strategy.
	 * 3. **Pressing a button must not dismiss it.** Focus has to stay in the
	 *    editor, or the selection collapses and the toolbar decides there is
	 *    nothing to show.
	 */
	let { editor, features }: { editor: LexicalEditor; features: readonly RichTextFeature[] } =
		$props();

	type Button = {
		feature: RichTextFeature;
		label: string;
		icon: string;
		active: () => boolean;
		run: () => void;
	};

	let visible = $state(false);
	let active = $state<Record<string, boolean>>({});
	let bar: HTMLDivElement | undefined = $state();

	/**
	 * True while a pointer is held down anywhere.
	 *
	 * The toolbar stays hidden for the whole gesture. Showing it while a
	 * selection is being dragged out puts a button under the moving cursor.
	 */
	let dragging = $state(false);

	function format(type: TextFormatType) {
		editor.dispatchCommand(FORMAT_TEXT_COMMAND, type);
	}

	const BUTTONS: Button[] = [
		{
			feature: 'bold',
			label: 'Bold',
			icon: 'bold',
			active: () => active.bold,
			run: () => format('bold')
		},
		{
			feature: 'italic',
			label: 'Italic',
			icon: 'italic',
			active: () => active.italic,
			run: () => format('italic')
		},
		{
			feature: 'strikethrough',
			label: 'Strikethrough',
			icon: 'strikethrough',
			active: () => active.strikethrough,
			run: () => format('strikethrough')
		},
		{
			feature: 'code',
			label: 'Code',
			icon: 'code',
			active: () => active.code,
			run: () => format('code')
		},
		{
			feature: 'link',
			label: 'Link',
			icon: 'link',
			active: () => active.link,
			run: () => promptForLink()
		},
		{
			feature: 'list',
			label: 'Bulleted list',
			icon: 'list-ul',
			active: () => active.bullet,
			run: () =>
				editor.dispatchCommand(
					active.bullet ? REMOVE_LIST_COMMAND : INSERT_UNORDERED_LIST_COMMAND,
					undefined
				)
		},
		{
			feature: 'list',
			label: 'Numbered list',
			icon: 'list-ol',
			active: () => active.number,
			run: () =>
				editor.dispatchCommand(
					active.number ? REMOVE_LIST_COMMAND : INSERT_ORDERED_LIST_COMMAND,
					undefined
				)
		}
	];

	const shown = $derived(BUTTONS.filter((button) => features.includes(button.feature)));

	/**
	 * `window.prompt` rather than a bespoke popover.
	 *
	 * A link dialog that has to preserve the selection across a focus change is
	 * a genuinely fiddly component, and this is a description box in a settings
	 * form. Worth replacing if link-heavy descriptions turn out to matter.
	 */
	function promptForLink() {
		if (active.link) {
			editor.update(() => toggleLink(null));
			return;
		}
		const entered = window.prompt('Link address');
		if (entered === null) return;
		const url = entered.trim();
		if (url === '') return;
		if (!isSafeHttpUrl(url)) {
			window.alert('That needs to be an http or https address.');
			return;
		}
		editor.update(() => toggleLink(url));
	}

	/** The live selection rectangle, as a Floating UI virtual element. */
	function selectionReference() {
		const domSelection = window.getSelection();
		if (!domSelection || domSelection.rangeCount === 0) return null;
		const range = domSelection.getRangeAt(0);
		if (range.collapsed) return null;
		const rect = range.getBoundingClientRect();
		if (rect.width === 0 && rect.height === 0) return null;
		return { getBoundingClientRect: () => range.getBoundingClientRect() };
	}

	function readSelection() {
		if (dragging) return;

		let hasRange = false;
		editor.getEditorState().read(() => {
			const selection = getSelection();
			if (!isRangeSelection(selection) || selection.isCollapsed()) return;

			const anchor = selection.anchor.getNode();
			const list = findMatchingParent(anchor, isListNode);
			active = {
				bold: selection.hasFormat('bold'),
				italic: selection.hasFormat('italic'),
				strikethrough: selection.hasFormat('strikethrough'),
				code: selection.hasFormat('code'),
				link: findMatchingParent(anchor, isLinkNode) !== null,
				bullet: isListNode(list) && list.getListType() === 'bullet',
				number: isListNode(list) && list.getListType() === 'number'
			};
			hasRange = true;
		});

		visible = hasRange && selectionReference() !== null;
	}

	/**
	 * Keeps the toolbar anchored to the selection.
	 *
	 * `autoUpdate` re-runs the placement on scroll and resize, which matters
	 * because the field itself scrolls independently of the page.
	 */
	$effect(() => {
		const element = bar;
		if (!visible || !element) return;
		const reference = selectionReference();
		if (!reference) return;

		const place = () => {
			void computePosition(reference, element, {
				placement: 'top',
				strategy: 'fixed',
				middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })]
			}).then(({ x, y }) => {
				element.style.left = `${x}px`;
				element.style.top = `${y}px`;
			});
		};
		return autoUpdate(reference, element, place);
	});

	/**
	 * Moves the toolbar out to `document.body`.
	 *
	 * Svelte has no portal, and this is the whole reason the toolbar used to
	 * distort the field it belongs to — see the note at the top.
	 */
	$effect(() => {
		const element = bar;
		if (!element) return;
		document.body.append(element);
		return () => element.remove();
	});

	$effect(() => {
		const offSelection = editor.registerCommand(
			SELECTION_CHANGE_COMMAND,
			() => {
				readSelection();
				return false;
			},
			COMMAND_PRIORITY_LOW
		);
		const offUpdate = editor.registerUpdateListener(() => readSelection());

		// A selection can also be dropped by clicking outside the editor, which
		// produces no Lexical command at all.
		const onSelectionChange = () => queueMicrotask(readSelection);
		const onPointerDown = (event: PointerEvent) => {
			// A press on the toolbar is not a drag, and must not hide it.
			if (bar?.contains(event.target as Node)) return;
			dragging = true;
			visible = false;
		};
		const onPointerUp = () => {
			dragging = false;
			queueMicrotask(readSelection);
		};

		document.addEventListener('selectionchange', onSelectionChange);
		document.addEventListener('pointerdown', onPointerDown, true);
		document.addEventListener('pointerup', onPointerUp, true);
		return () => {
			offSelection();
			offUpdate();
			document.removeEventListener('selectionchange', onSelectionChange);
			document.removeEventListener('pointerdown', onPointerDown, true);
			document.removeEventListener('pointerup', onPointerUp, true);
		};
	});
</script>

{#if shown.length > 0}
	<div
		bind:this={bar}
		class="toolbar"
		class:hidden={!visible || dragging}
		role="toolbar"
		aria-label="Text formatting"
	>
		{#each shown as button (button.label)}
			<button
				type="button"
				class:active={button.active()}
				aria-label={button.label}
				aria-pressed={button.active()}
				onpointerdown={(event) => {
					// Keeps the selection alive: without this the editor loses focus
					// on press, the selection collapses, and the toolbar dismisses
					// itself before the click it was pressed for ever lands.
					event.preventDefault();
				}}
				onclick={button.run}
			>
				<wa-icon name={button.icon} variant="solid"></wa-icon>
			</button>
		{/each}
	</div>
{/if}

<style>
	.toolbar {
		/* Positioned by Floating UI in the `fixed` strategy, from `document.body`. */
		position: fixed;
		inset-block-start: 0;
		inset-inline-start: 0;
		z-index: 40;
		display: flex;
		gap: 0.125rem;
		padding: 0.25rem;
		border-radius: 0.5rem;
		border: 1px solid var(--wa-color-surface-border);
		background: var(--wa-color-surface-raised, white);
		box-shadow: 0 0.5rem 1.5rem rgb(0 0 0 / 18%);
	}

	/* Hidden rather than unmounted, so Floating UI keeps its measurements and
	   the element stays available to the pointer handlers. */
	.toolbar.hidden {
		opacity: 0;
		pointer-events: none;
	}

	button {
		display: grid;
		place-items: center;
		inline-size: 2rem;
		block-size: 2rem;
		border: none;
		border-radius: 0.375rem;
		background: none;
		color: inherit;
		cursor: pointer;
		font-size: 0.875rem;

		&:hover {
			background: var(--wa-color-neutral-fill-quiet, rgb(0 0 0 / 8%));
		}

		&.active {
			background: var(--wa-color-brand-fill-quiet, rgb(37 99 235 / 18%));
		}
	}
</style>
