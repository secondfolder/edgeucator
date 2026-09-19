<script lang="ts">
	import RichTextInline from './RichTextInline.svelte';
	import UrlEmbed from './UrlEmbed.svelte';
	import { embedSpecFor, type CachedEmbedDetails } from '$lib/embeds';
	import { parseStoredRichText } from '$lib/richtext';

	/**
	 * Message, task and reward prose.
	 *
	 * Takes the **stored string** and renders it. What is stored is a Lexical
	 * `editorState.toJSON()` document; `parseStoredRichText` is the one boundary
	 * that turns it — or a legacy plain-text row — into a document, so nothing
	 * below here knows two formats ever existed. See docs/rich-text.md.
	 *
	 * Deliberately no Lexical import. The serialised state is plain JSON, so
	 * displaying a message needs no editor and no DOM, and a page that only
	 * shows descriptions ships none of the editor. Reintroducing a Lexical
	 * import here would undo that for every such page.
	 *
	 * No `{@html}`: every character goes through ordinary interpolation. The
	 * only sanitised markup in the app lives inside `UrlEmbed`.
	 *
	 * Embeds are their own block nodes rather than a property of the link that
	 * produced them, which is why there is no `maxEmbeds` any more — a document
	 * contains exactly the embeds it says it contains. `embedSpecFor` still runs
	 * here rather than being stored, so a provider we drop degrades to a link
	 * instead of leaving a hole.
	 */
	let {
		text,
		cachedEmbeds = [],
		cachedEmbedsPending = false,
		autoLoadEmbeds = false,
		requireExplicitReveal = false,
		onRevealEmbed = undefined,
		onRefreshEmbed = undefined
	}: {
		text: string;
		cachedEmbeds?: CachedEmbedDetails[];
		cachedEmbedsPending?: boolean;
		autoLoadEmbeds?: boolean;
		requireExplicitReveal?: boolean;
		onRevealEmbed?: ((href: string) => void | Promise<void>) | undefined;
		onRefreshEmbed?: ((href: string) => void | Promise<void>) | undefined;
	} = $props();

	const blocks = $derived(parseStoredRichText(text).root.children);
	const cachedByHref = $derived(new Map(cachedEmbeds.map((embed) => [embed.href, embed])));
</script>

{#each blocks as block, index (index)}
	{#if block.type === 'paragraph'}
		<p><RichTextInline nodes={block.children} /></p>
	{:else if block.type === 'list'}
		{#if block.listType === 'number'}
			<ol start={block.start}>
				{#each block.children as item, itemIndex (itemIndex)}
					<li><RichTextInline nodes={item.children} /></li>
				{/each}
			</ol>
		{:else}
			<ul>
				{#each block.children as item, itemIndex (itemIndex)}
					<li><RichTextInline nodes={item.children} /></li>
				{/each}
			</ul>
		{/if}
	{:else if embedSpecFor(block.url)}
		<UrlEmbed
			spec={embedSpecFor(block.url)!}
			href={block.url}
			label={block.url}
			cached={cachedByHref.get(block.url) ?? null}
			cachedPending={cachedEmbedsPending}
			autoLoad={autoLoadEmbeds}
			{requireExplicitReveal}
			onReveal={onRevealEmbed}
			onRefresh={onRefreshEmbed}
		/>
	{:else}
		<!-- An embed whose provider we no longer support. It degrades to the
		     link it was made from rather than vanishing. -->
		<p>
			<a href={block.url} target="_blank" rel="noopener noreferrer ugc">{block.url}</a>
		</p>
	{/if}
{/each}

<style>
	p,
	ul,
	ol {
		margin: 0;
	}

	p + p,
	p + ul,
	p + ol,
	ul + p,
	ol + p {
		margin-block-start: 0.5em;
	}

	ul,
	ol {
		padding-inline-start: 1.5em;
	}

	/* Long URLs and unbroken strings must not widen a message bubble. */
	p {
		overflow-wrap: anywhere;
	}
</style>
