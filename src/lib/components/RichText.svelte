<script lang="ts">
	import UrlEmbed from './UrlEmbed.svelte';
	import { findRenderableLinks, type CachedEmbedDetails, type EmbedSpec } from '$lib/embeds';

	/**
	 * Message/task/reward prose with URLs turned into links and, for hosts we
	 * can embed, into inline embeds.
	 *
	 * Rendering strategy: linkifyjs only *finds* the URLs; this component then
	 * emits plain text nodes and real `<a>` elements through normal Svelte
	 * interpolation, so — like everywhere else in this app — no message text
	 * ever passes through `{@html}` and the XSS surface stays at zero. The one
	 * sanitised `{@html}` in the app lives inside UrlEmbed, and only ever sees
	 * DOMPurify-cleaned oEmbed markup.
	 *
	 * Whitespace is preserved by the parent's `white-space: pre-wrap` — this
	 * component emits inline content only.
	 *
	 * `maxEmbeds` exists so headings can linkify without growing an embed
	 * inside them (titles pass 0). Prose embeds every supported URL.
	 */
	type Token =
		| { type: 'text'; value: string }
		| {
				type: 'link';
				value: string;
				href: string;
				embed: EmbedSpec | null;
				cached: CachedEmbedDetails | null;
				cachedPending: boolean;
				requireExplicitReveal: boolean;
		  };

	let {
		text,
		maxEmbeds = Infinity,
		cachedEmbeds = [],
		cachedEmbedsPending = false,
		autoLoadEmbeds = false,
		requireExplicitReveal = false,
		onRevealEmbed = undefined,
		onRefreshEmbed = undefined
	}: {
		text: string;
		maxEmbeds?: number;
		cachedEmbeds?: CachedEmbedDetails[];
		cachedEmbedsPending?: boolean;
		autoLoadEmbeds?: boolean;
		requireExplicitReveal?: boolean;
		onRevealEmbed?: ((href: string) => void | Promise<void>) | undefined;
		onRefreshEmbed?: ((href: string) => void | Promise<void>) | undefined;
	} = $props();

	const tokens = $derived.by(() => {
		const found = findRenderableLinks(text, maxEmbeds);
		const cachedByHref = new Map(cachedEmbeds.map((embed) => [embed.href, embed]));

		const result: Token[] = [];
		let cursor = 0;
		for (const match of found) {
			if (match.start > cursor) {
				result.push({ type: 'text', value: text.slice(cursor, match.start) });
			}
			result.push({
				type: 'link',
				value: match.value,
				href: match.href,
				embed: match.embed,
				cached: cachedByHref.get(match.href) ?? null,
				cachedPending: cachedEmbedsPending && match.embed !== null,
				requireExplicitReveal: requireExplicitReveal && match.embed !== null
			});
			cursor = match.end;
		}
		if (cursor < text.length) {
			result.push({ type: 'text', value: text.slice(cursor) });
		}
		return result;
	});
</script>

{#each tokens as token, index (index)}
	{#if token.type === 'text'}
		{token.value}
	{:else if token.embed}
		<UrlEmbed
			spec={token.embed}
			href={token.href}
			label={token.value}
			cached={token.cached}
			cachedPending={token.cachedPending}
			autoLoad={autoLoadEmbeds}
			requireExplicitReveal={token.requireExplicitReveal}
			onReveal={onRevealEmbed}
			onRefresh={onRefreshEmbed}
		/>
	{:else}
		<a href={token.href} target="_blank" rel="noopener noreferrer ugc">{token.value}</a>
	{/if}
{/each}
