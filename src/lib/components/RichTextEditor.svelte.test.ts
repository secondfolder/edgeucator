import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it } from 'vitest';
import {
	$createTextNode as createTextNode,
	$getRoot as getRoot,
	type LexicalEditor
} from 'lexical';
import RichTextEditorHarness from './RichTextEditorHarness.svelte';
import { FORMAT_BOLD, FORMAT_ITALIC, FORMAT_STRIKETHROUGH } from '$lib/richtext';

/**
 * jsdom never upgrades `wa-*` elements, so these assert on what the component
 * emits rather than on rendered behaviour — per AGENTS.md. Real typing, with a
 * real caret, lives in the Playwright suite.
 *
 * Everything here goes through `RichTextEditorHarness`, which feeds each change
 * back into `value` the way a form does. That loop is what the editor has to
 * survive, and it cannot be reproduced with `rerender`: replacing the props
 * object re-runs the setup effect on its own, so a test built that way passes
 * and fails for reasons that have nothing to do with the component.
 */

/**
 * The live editor behind a mounted surface.
 *
 * Lexical hangs it off the root element, which is how its own devtools find it.
 * Reached for here because a real edit is the only thing that makes the
 * component emit, and the bug under test only appears once it has.
 */
function editorOf(container: HTMLElement): LexicalEditor {
	const surface = container.querySelector('.surface');
	const editor = (surface as unknown as { __lexicalEditor?: LexicalEditor })?.__lexicalEditor;
	if (!editor) throw new Error('no Lexical editor mounted on .surface');
	return editor;
}

/** Appends text the way a keystroke would, so the update listener fires. */
function typeInto(container: HTMLElement, value: string) {
	editorOf(container).update(
		() => {
			const first = getRoot().getFirstChild();
			if (first && 'append' in first) {
				(first as unknown as { append: (node: unknown) => void }).append(createTextNode(value));
			}
		},
		{ discrete: true }
	);
}

describe('RichTextEditor', () => {
	it('mounts an editing surface', async () => {
		const { container } = render(RichTextEditorHarness);
		await tick();
		const surface = container.querySelector('.surface');
		expect(surface?.getAttribute('contenteditable')).toBe('true');
		expect(surface?.getAttribute('data-lexical-editor')).toBe('true');
	});

	it('loads an existing document', async () => {
		const stored = JSON.stringify({
			root: {
				type: 'root',
				children: [
					{ type: 'paragraph', children: [{ type: 'text', text: 'already here', format: 0 }] }
				]
			}
		});
		const { container } = render(RichTextEditorHarness, { props: { initial: stored } });
		await tick();
		expect(container.querySelector('.surface')?.textContent).toContain('already here');
	});

	/**
	 * The regression this file was written for.
	 *
	 * `TaskForm` feeds `onChange` straight back into `value`, so `value` changes
	 * on every keystroke. While the editor's setup effect read `value`, that
	 * rebuilt the whole editor between keystrokes: the caret went back to the
	 * start, so characters landed in reverse order, and a selection was dropped
	 * the instant it was made.
	 */
	it('survives its own change being fed back by the parent', async () => {
		const { container } = render(RichTextEditorHarness);
		await tick();

		const surface = container.querySelector('.surface');
		const editorBefore = editorOf(container);

		typeInto(container, 'a');
		await tick();

		// The same element, the same editor instance, and the text still there.
		expect(container.querySelector('.surface')).toBe(surface);
		expect(editorOf(container)).toBe(editorBefore);
		expect(surface?.textContent).toContain('a');
	});

	it('keeps accumulating across several changes rather than only the first', async () => {
		const { container } = render(RichTextEditorHarness);
		await tick();

		const editorBefore = editorOf(container);
		for (const character of ['a', 'b', 'c']) {
			typeInto(container, character);
			await tick();
		}

		expect(editorOf(container)).toBe(editorBefore);
		expect(container.querySelector('.surface')?.textContent).toContain('abc');
	});

	/**
	 * Lexical draws a text node as *one* tag: `getElementInnerTag` returns
	 * `strong` for bold, `em` for italic, and never both. Every format past that
	 * first tag is carried by a theme class instead, so an editor built without
	 * a theme silently shows only one of the formats a node actually has —
	 * bold+italic looked merely bold, and strikethrough looked like nothing at
	 * all, while the stored document had the bits set all along.
	 *
	 * Asserting on the class names rather than on computed style is deliberate:
	 * the class is the whole mechanism, and jsdom does not apply the component's
	 * stylesheet anyway.
	 */
	it('marks every format on a text node, not just the first', async () => {
		const stored = JSON.stringify({
			root: {
				type: 'root',
				children: [
					{
						type: 'paragraph',
						children: [
							{ type: 'text', text: 'both', format: FORMAT_BOLD | FORMAT_ITALIC },
							{ type: 'text', text: 'struck', format: FORMAT_STRIKETHROUGH }
						]
					}
				]
			}
		});
		const { container } = render(RichTextEditorHarness, { props: { initial: stored } });
		await tick();

		const both = container.querySelector('.surface strong');
		expect(both?.textContent).toBe('both');
		expect(both?.className).toContain('rt-italic');

		const struck = [...container.querySelectorAll('.surface *')].find(
			(element) => element.textContent === 'struck'
		);
		expect(struck?.className).toContain('rt-strikethrough');
	});

	it('still accepts a value that genuinely arrives from outside', async () => {
		const { container, component } = render(RichTextEditorHarness);
		await tick();

		(component as unknown as { replace: (next: string) => void }).replace(
			JSON.stringify({
				root: {
					type: 'root',
					children: [
						{ type: 'paragraph', children: [{ type: 'text', text: 'replaced', format: 0 }] }
					]
				}
			})
		);
		await tick();

		expect(container.querySelector('.surface')?.textContent).toContain('replaced');
	});
});
