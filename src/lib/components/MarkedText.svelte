<script lang="ts">
	import Self from './MarkedText.svelte';
	import {
		FORMAT_BOLD,
		FORMAT_CODE,
		FORMAT_ITALIC,
		FORMAT_STRIKETHROUGH,
		hasFormat
	} from '$lib/richtext';

	/**
	 * One text node, wrapped in whatever its format bits ask for.
	 *
	 * Lexical stores formatting as a bitfield on the text node rather than as
	 * nested nodes, so `**bold *and italic***` arrives as a single node with two
	 * bits set. This recurses through the bits one at a time, which keeps the
	 * nesting order fixed: the same combination always produces the same markup,
	 * which is what makes the component tests worth writing.
	 *
	 * Underline is deliberately absent. It is not in the stored format (the
	 * editor swallows Ctrl+U for that reason), so a document carrying the bit —
	 * hand-crafted, or from a future Lexical that sets it — renders as plain
	 * text rather than as something we cannot round-trip.
	 */
	let { text, format }: { text: string; format: number } = $props();

	/** Outermost first. */
	const WRAPPERS: [number, string][] = [
		[FORMAT_BOLD, 'strong'],
		[FORMAT_ITALIC, 'em'],
		[FORMAT_STRIKETHROUGH, 's'],
		[FORMAT_CODE, 'code']
	];

	const wrapper = $derived(WRAPPERS.find(([bit]) => hasFormat(format, bit)));
	// The consumed bit is cleared, so the recursion always terminates.
	const rest = $derived(wrapper ? format & ~wrapper[0] : 0);
</script>

{#if wrapper}<svelte:element this={wrapper[1]}><Self {text} format={rest} /></svelte:element
	>{:else}{text}{/if}
