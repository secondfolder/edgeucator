import { find as findLinks } from 'linkifyjs';
import { embedSpecFor, isSafeHttpUrl } from '$lib/embeds';
import type { RichTextBlockNode, RichTextDocument, RichTextInlineNode } from '$lib/richtext';

/**
 * TEMPORARY — reads content written before rich text existed.
 *
 * Every message body, task description and reward description written before
 * the Lexical change is a **plain string**: the composer was a `<wa-textarea>`
 * and the renderer linkified it and preserved whitespace with `pre-wrap`. No
 * markdown was ever stored or interpreted, so there is no markdown to parse
 * here — only text, the URLs inside it, and the embeds those URLs earned.
 *
 * This whole file goes away once nothing legacy is left. See
 * docs/temporary-code.md for the removal contract and how to tell when that
 * is. Every call site outside this file carries a `LEGACY-RICHTEXT` comment,
 * so `grep -rn 'LEGACY-RICHTEXT' src` is the complete list.
 *
 * Deliberately free of Lexical: it builds the serialised shape directly. That
 * keeps the editor off the read path, which is the one property the whole
 * rich-text design is built around.
 */

/**
 * Convert legacy plain text into a document.
 *
 * Faithfulness rules, in the order they mattered:
 *
 * - **Blank lines separate paragraphs; single newlines are line breaks.** The
 *   old renderer drew everything inside one `pre-wrap` block, so this is the
 *   one place the conversion is not pixel-identical — paragraph spacing
 *   replaces a doubled line break. Everything else round-trips exactly.
 * - **Every URL a provider supports gets an embed**, with no cap and no user
 *   choice, because message bodies already rendered with an unlimited embed
 *   budget. That is what makes a converted message look like it did before,
 *   rather than approximately like it.
 * - **A host with no provider stays a plain link.** An embed node for it would
 *   have no `EmbedSpec` to draw, and it rendered as a plain link before.
 */
export function legacyTextToDocument(text: string): RichTextDocument {
	const children: RichTextBlockNode[] = [];

	for (const chunk of text.split(/\n[ \t]*\n+/)) {
		const inlines = inlinesFrom(chunk);
		if (inlines.length === 0) continue;

		// Embeds sit above the paragraph that mentions them, matching where the
		// editor puts one now. Deduplicated within the paragraph: the same URL
		// twice in one breath meant one video, not two.
		const seen = new Set<string>();
		for (const url of embeddableUrlsIn(inlines)) {
			if (seen.has(url)) continue;
			seen.add(url);
			children.push({ type: 'embed', url });
		}
		children.push({ type: 'paragraph', children: inlines });
	}

	return { root: { type: 'root', children } };
}

function embeddableUrlsIn(inlines: RichTextInlineNode[]): string[] {
	const urls: string[] = [];
	for (const node of inlines) {
		if (node.type !== 'link' && node.type !== 'autolink') continue;
		if (embedSpecFor(node.url)) urls.push(node.url);
	}
	return urls;
}

/**
 * Split one paragraph's text into text, line breaks and auto-links.
 *
 * linkifyjs rather than a URL regex, because it is what the old renderer used:
 * the set of things that counted as a link — `www.` prefixes, bare domains —
 * has to stay exactly the same, or converting a message would quietly add or
 * drop links it used to show. It is also the same matcher the editor
 * auto-links with, so converted and newly typed content agree.
 */
function inlinesFrom(chunk: string): RichTextInlineNode[] {
	// A run of nothing but whitespace is not a paragraph.
	if (chunk.trim() === '') return [];

	const out: RichTextInlineNode[] = [];
	chunk.split('\n').forEach((line, index) => {
		if (index > 0) out.push({ type: 'linebreak' });
		out.push(...linkify(line));
	});
	return out;
}

function linkify(line: string): RichTextInlineNode[] {
	if (line === '') return [];

	const matches = findLinks(line).filter(
		(match) => match.type === 'url' && isSafeHttpUrl(match.href)
	);
	if (matches.length === 0) return [{ type: 'text', text: line, format: 0 }];

	const out: RichTextInlineNode[] = [];
	let cursor = 0;
	for (const match of matches) {
		if (match.start > cursor) {
			out.push({ type: 'text', text: line.slice(cursor, match.start), format: 0 });
		}
		out.push({
			// `autolink`, not `link`: these were bare URLs in the prose, so the
			// text equals the href — which is exactly the invariant an autolink
			// node carries, and what the editor would have produced.
			type: 'autolink',
			url: match.href,
			isUnlinked: false,
			children: [{ type: 'text', text: match.value, format: 0 }]
		});
		cursor = match.end;
	}
	if (cursor < line.length) {
		out.push({ type: 'text', text: line.slice(cursor), format: 0 });
	}
	return out;
}
