<script lang="ts">
	import Self from './RichTextInline.svelte';
	import MarkedText from './MarkedText.svelte';
	import { isSafeHttpUrl } from '$lib/embeds';
	import type { RichTextInlineNode } from '$lib/richtext';

	/**
	 * The inline half of the renderer: text, line breaks and links.
	 *
	 * Everything is emitted through ordinary Svelte interpolation and real
	 * elements — no `{@html}`, ever. That is the property the whole rendering
	 * design exists to keep: message and description text has an XSS surface of
	 * zero because it is never parsed as markup. The one sanitised `{@html}` in
	 * the app lives inside `UrlEmbed`, and only ever sees DOMPurify-cleaned
	 * oEmbed markup.
	 *
	 * The markup is written without whitespace between the block tags on
	 * purpose: a newline there becomes a rendered space, which would insert
	 * gaps between adjacent text nodes that the author never typed.
	 */
	let { nodes }: { nodes: RichTextInlineNode[] } = $props();

	/**
	 * A link renders as plain text when it is unlinked or its URL is not safe.
	 *
	 * `isUnlinked` is Lexical's own flag for "the user removed the link from
	 * something that still looks like a URL". Honouring it matters: without
	 * this, the renderer would silently re-link text somebody deliberately
	 * unlinked.
	 *
	 * The scheme check is defence in depth. The schema and the editor both
	 * refuse a `javascript:` URL already; this is the last gate before an
	 * `href` reaches the DOM, and it is cheap.
	 */
	function isPlain(node: Extract<RichTextInlineNode, { type: 'link' | 'autolink' }>): boolean {
		return node.isUnlinked === true || !isSafeHttpUrl(node.url);
	}
</script>

{#each nodes as node, index (index)}{#if node.type === 'text'}<MarkedText
			text={node.text}
			format={node.format}
		/>{:else if node.type === 'linebreak'}<br />{:else if isPlain(node)}<Self
			nodes={node.children}
		/>{:else}<a href={node.url} target="_blank" rel="noopener noreferrer ugc"
			><Self nodes={node.children} /></a
		>{/if}{/each}
