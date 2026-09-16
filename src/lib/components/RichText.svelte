<script lang="ts">
	import { find as findLinks } from 'linkifyjs';
	import UrlEmbed from './UrlEmbed.svelte';
	import { embedSpecFor, isSafeHttpUrl, type EmbedSpec } from '$lib/embeds';

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
		| { type: 'link'; value: string; href: string; embed: EmbedSpec | null };

	let { text, maxEmbeds = Infinity }: { text: string; maxEmbeds?: number } = $props();

	const tokens = $derived.by(() => {
		const found = findLinks(text)
			// Only http(s) URLs, and only ones linkifyjs normalises to a scheme
			// we are willing to put in an href.
			.filter((match) => match.type === 'url' && isSafeHttpUrl(match.href));

		const result: Token[] = [];
		let cursor = 0;
		let embedsUsed = 0;
		for (const match of found) {
			if (match.start > cursor) {
				result.push({ type: 'text', value: text.slice(cursor, match.start) });
			}
			// Every supported URL becomes an embed (the user's call — a
			// link-heavy message stacks one player per link, and that is wanted).
			// maxEmbeds only exists so headings can pass 0.
			const embed = embedsUsed < maxEmbeds ? embedSpecFor(match.href) : null;
			if (embed) embedsUsed += 1;
			result.push({ type: 'link', value: match.value, href: match.href, embed });
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
		<UrlEmbed spec={token.embed} href={token.href} label={token.value} />
	{:else}
		<a href={token.href} target="_blank" rel="noopener noreferrer ugc">{token.value}</a>
	{/if}
{/each}
