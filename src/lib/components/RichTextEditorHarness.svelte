<script lang="ts">
	import RichTextEditor from './RichTextEditor.svelte';
	import { DOCUMENT_FEATURES } from '$lib/richtext-editor';

	/**
	 * A parent that feeds every change straight back into `value` — exactly what
	 * `TaskForm` does through superforms, and what `RewardForm` does with its
	 * own state.
	 *
	 * That loop is the whole point of the harness. It is what the editor has to
	 * survive: a setup effect that depends on `value` rebuilds the editor once
	 * per keystroke, which throws the caret back to the start and drops any
	 * selection. Testing it through `rerender` cannot show this, because
	 * replacing the props object re-runs the setup effect either way.
	 */
	let { initial = '' }: { initial?: string } = $props();

	// svelte-ignore state_referenced_locally
	let value = $state(initial);
	let editor: ReturnType<typeof RichTextEditor> | undefined = $state();

	/** The value the editor last reported, for assertions. */
	export function current(): string {
		return value;
	}

	/**
	 * A value arriving from outside.
	 *
	 * Goes through the editor's own `setValue`, because `value` is the initial
	 * value only — see the note in `RichTextEditor.svelte`.
	 */
	export function replace(next: string): void {
		editor?.setValue(next);
	}
</script>

<RichTextEditor
	bind:this={editor}
	{value}
	onChange={(next) => (value = next)}
	features={DOCUMENT_FEATURES}
	placeholder="Describe it"
/>
