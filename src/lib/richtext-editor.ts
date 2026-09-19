import {
	$applyNodeReplacement,
	$getRoot,
	$isElementNode,
	COMMAND_PRIORITY_NORMAL,
	DecoratorNode,
	FORMAT_TEXT_COMMAND,
	createEditor,
	type Klass,
	type LexicalEditor,
	type LexicalNode,
	type NodeKey,
	type SerializedLexicalNode,
	type Spread
} from 'lexical';
import { registerRichText } from '@lexical/rich-text';
import { registerHistory, createEmptyHistoryState } from '@lexical/history';
import { ListItemNode, ListNode, registerList } from '@lexical/list';
import {
	AutoLinkNode,
	LinkNode,
	$isAutoLinkNode,
	registerAutoLink,
	type LinkMatcher
} from '@lexical/link';
import {
	BOLD_STAR,
	INLINE_CODE,
	ITALIC_UNDERSCORE,
	ORDERED_LIST,
	STRIKETHROUGH,
	UNORDERED_LIST,
	registerMarkdownShortcuts,
	type TextFormatTransformer,
	type Transformer
} from '@lexical/markdown';
import { find as findLinks } from 'linkifyjs';
import { embedSpecFor, isSafeHttpUrl } from '$lib/embeds';

/**
 * The editor half of rich text: the node set, the typing shortcuts, and the
 * rules that turn a typed URL into a link and, where we can, into an embed.
 *
 * This module imports Lexical; `richtext.ts` does not, and must not. Only
 * screens with an editor on them pay for the library — see the note there.
 */

/* ── features ──────────────────────────────────────────────────────────── */

export type RichTextFeature = 'bold' | 'italic' | 'strikethrough' | 'code' | 'link' | 'list';

/**
 * What a message may contain. No lists: a chat box that turns "- " into a
 * bulleted list because someone started a line with a dash is a worse chat
 * box, and Messenger does not do it either.
 */
export const MESSAGE_FEATURES: readonly RichTextFeature[] = [
	'bold',
	'italic',
	'strikethrough',
	'code',
	'link'
];

/** What a description may contain. Written in a form, read as prose later. */
export const DOCUMENT_FEATURES: readonly RichTextFeature[] = [
	'bold',
	'italic',
	'strikethrough',
	'code',
	'link',
	'list'
];

/* ── the embed node ────────────────────────────────────────────────────── */

export type SerializedEmbedNode = Spread<{ url: string }, SerializedLexicalNode>;

/**
 * A block-level embed.
 *
 * Its own node rather than a flag on the link that produced it, and that is
 * the whole design: because it is a real block, a sender who does not want
 * the embed selects it and presses backspace. There is no opt-out state to
 * store and no opt-out UI to build — the editor already has one.
 *
 * A `DecoratorNode` so it behaves as one indivisible object: selected as a
 * unit, deleted in one keystroke. The preview DOM is built in `createDOM`
 * rather than through `decorate`, because nothing in this app renders Lexical
 * decorators — the read-only renderer walks JSON instead, and the composer
 * only needs a quiet placeholder.
 */
export class EmbedNode extends DecoratorNode<null> {
	__url: string;

	static getType(): string {
		return 'embed';
	}

	static clone(node: EmbedNode): EmbedNode {
		return new EmbedNode(node.__url, node.__key);
	}

	constructor(url: string, key?: NodeKey) {
		super(key);
		this.__url = url;
	}

	getUrl(): string {
		return this.__url;
	}

	isInline(): false {
		return false;
	}

	createDOM(): HTMLElement {
		const wrapper = document.createElement('div');
		wrapper.className = 'richtext-embed-chip';
		wrapper.setAttribute('contenteditable', 'false');
		wrapper.setAttribute('aria-label', `Embedded preview of ${this.__url}`);

		const icon = document.createElement('span');
		icon.className = 'richtext-embed-chip__icon';
		icon.setAttribute('aria-hidden', 'true');
		icon.textContent = '▶';

		const label = document.createElement('span');
		label.className = 'richtext-embed-chip__label';
		// The host, not the whole URL: the URL is already in the paragraph below
		// and a second copy of a long one makes the composer unreadable.
		label.textContent = hostOf(this.__url);

		wrapper.append(icon, label);
		return wrapper;
	}

	updateDOM(prevNode: EmbedNode): boolean {
		return prevNode.__url !== this.__url;
	}

	/**
	 * Nothing renders Lexical decorators here, so this is deliberately inert.
	 * The composer shows the chip built in `createDOM`; the reader draws the
	 * real embed from the serialised node.
	 */
	decorate(): null {
		return null;
	}

	static importJSON(serialised: SerializedEmbedNode): EmbedNode {
		return $createEmbedNode(serialised.url).updateFromJSON(serialised);
	}

	exportJSON(): SerializedEmbedNode {
		return { ...super.exportJSON(), url: this.__url };
	}
}

function hostOf(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, '');
	} catch {
		return url;
	}
}

export function $createEmbedNode(url: string): EmbedNode {
	return $applyNodeReplacement(new EmbedNode(url));
}

export function $isEmbedNode(node: LexicalNode | null | undefined): node is EmbedNode {
	return node instanceof EmbedNode;
}

/** Every node type the document may contain. A type absent here cannot exist. */
export const RICH_TEXT_NODES: readonly Klass<LexicalNode>[] = [
	ListNode,
	ListItemNode,
	LinkNode,
	AutoLinkNode,
	EmbedNode
];

/* ── typing shortcuts ──────────────────────────────────────────────────── */

/**
 * Messenger/WhatsApp shorthand: `*bold*`, `_italic_`, `~struck~`.
 *
 * These are **typing** shortcuts only. They never appear in the stored
 * document, which is Lexical's own JSON — so unlike a markdown-backed editor
 * there is no dialect to round-trip and no escaping to get wrong. Someone who
 * types `5 * 3 * 2` gets exactly that, stored exactly that way.
 *
 * The CommonMark doubles are kept alongside, because people who know markdown
 * reach for them and there is no reason to refuse.
 */
const BOLD_SINGLE_STAR: TextFormatTransformer = {
	format: ['bold'],
	tag: '*',
	type: 'text-format'
};

const STRIKETHROUGH_SINGLE: TextFormatTransformer = {
	format: ['strikethrough'],
	tag: '~',
	type: 'text-format'
};

const TRANSFORMERS_BY_FEATURE: Record<RichTextFeature, Transformer[]> = {
	// `**` before `*`, so the double is matched as bold rather than as an empty
	// single-star pair wrapping a star.
	bold: [BOLD_STAR, BOLD_SINGLE_STAR],
	italic: [ITALIC_UNDERSCORE],
	strikethrough: [STRIKETHROUGH, STRIKETHROUGH_SINGLE],
	code: [INLINE_CODE],
	link: [],
	list: [UNORDERED_LIST, ORDERED_LIST]
};

export function typingTransformersFor(features: readonly RichTextFeature[]): Transformer[] {
	return features.flatMap((feature) => TRANSFORMERS_BY_FEATURE[feature]);
}

/* ── links ─────────────────────────────────────────────────────────────── */

/**
 * The one answer to "is this a URL", shared by the editor and by the legacy
 * reader in `richtext-legacy.ts`.
 *
 * linkifyjs rather than a regex because it is what the app linkified with
 * before rich text existed — it catches `www.` prefixes and bare domains that
 * a naive URL pattern misses. Keeping it means converted and newly typed
 * content agree about what counts as a link.
 */
export const linkifyMatcher: LinkMatcher = (text: string) => {
	const match = findLinks(text).find(
		(candidate) => candidate.type === 'url' && isSafeHttpUrl(candidate.href)
	);
	if (!match) return null;
	return {
		index: match.start,
		length: match.end - match.start,
		text: match.value,
		url: match.href
	};
};

/* ── embeds ────────────────────────────────────────────────────────────── */

/**
 * Insert an embed above the paragraph holding `link`, if we can embed it and
 * have not already.
 *
 * Must run inside an `editor.update()`. Returns true when it inserted one.
 */
export function $insertEmbedForLink(link: LexicalNode): boolean {
	if (!$isAutoLinkNode(link)) return false;
	const url = link.getURL();
	if (!embedSpecFor(url)) return false;

	const block = link.getParent();
	if (!block || !$isElementNode(block) || block.getParent() !== $getRoot()) return false;

	// Idempotent: typing the same URL again, or leaving and re-entering the
	// link, must not stack duplicate embeds above the paragraph.
	if (hasEmbedAbove(block, url)) return false;

	block.insertBefore($createEmbedNode(url));
	return true;
}

function hasEmbedAbove(block: LexicalNode, url: string): boolean {
	for (const sibling of block.getPreviousSiblings()) {
		if ($isEmbedNode(sibling) && sibling.getUrl() === url) return true;
	}
	return false;
}

/**
 * The auto-links that ought to have an embed above them and do not.
 *
 * `exceptKey` is the link the caret is currently inside, which is skipped: an
 * embed must not pop up while someone is still halfway through typing the URL.
 * Everything else is fair game, which is what makes a **pasted** block of text
 * — or several URLs typed in one go — get its embeds immediately rather than
 * only the one the caret happened to leave.
 *
 * Must be called inside a `read` or an `update`.
 */
export function $autoLinksAwaitingEmbeds(exceptKey: string | null): LexicalNode[] {
	const waiting: LexicalNode[] = [];
	for (const block of $getRoot().getChildren()) {
		if (!$isElementNode(block)) continue;
		for (const child of block.getChildren()) {
			if (!$isAutoLinkNode(child) || child.getKey() === exceptKey) continue;
			if (!embedSpecFor(child.getURL())) continue;
			if (hasEmbedAbove(block, child.getURL())) continue;
			waiting.push(child);
		}
	}
	return waiting;
}

/* ── the editor ────────────────────────────────────────────────────────── */

/**
 * The class names Lexical hangs on formatted text.
 *
 * Not cosmetic — without this, formats silently go missing on screen.
 * Lexical draws a text node as a **single** tag: `getElementInnerTag` returns
 * `strong` for bold, `em` for italic and `span` otherwise, so a node that is
 * both bold and italic renders as `<strong>` alone, and strikethrough renders
 * as a bare `<span>`. Every format past that first tag is expected to come
 * from a theme class. The document had the bits set the whole time; the editor
 * just had no way to show them.
 *
 * Styled in `RichTextEditor.svelte`, which has to reach them through
 * `:global()` because Lexical owns the markup inside the surface.
 *
 * `code` needs no entry: Lexical gives it a real `<code>` element as the outer
 * tag, which is exactly what the reader sees. `underline` is absent on
 * purpose — it is not part of the stored format (the editor swallows Ctrl+U)
 * and the read-only renderer ignores the bit too, so a class here would make
 * the editor show something no reader ever would.
 */
const EDITOR_THEME = {
	text: {
		bold: 'rt-bold',
		italic: 'rt-italic',
		strikethrough: 'rt-strikethrough'
	}
};

export type RichTextEditorHandle = {
	editor: LexicalEditor;
	destroy: () => void;
};

/**
 * Build an editor and wire every behaviour it needs.
 *
 * Note the ordering constraint that is easy to get wrong: `registerAutoLink`
 * works through **node transforms, which run after the update callback
 * returns**. Anything that needs to see auto-link nodes — inserting embeds
 * above them, for instance — has to happen in a later update, which is why
 * embed insertion hangs off the selection listener rather than off the
 * keystroke that produced the link.
 */
export function createRichTextEditor(options: {
	features: readonly RichTextFeature[];
	namespace: string;
	onError?: (error: Error) => void;
}): RichTextEditorHandle {
	const editor = createEditor({
		namespace: options.namespace,
		nodes: [...RICH_TEXT_NODES],
		theme: EDITOR_THEME,
		onError:
			options.onError ??
			((error) => {
				// Never throw out of the editor: a broken paste must not take the
				// whole composer down with it.
				console.error('[richtext]', error);
			})
	});

	const teardown: (() => void)[] = [
		registerRichText(editor),
		registerHistory(editor, createEmptyHistoryState(), 300),
		registerAutoLink(editor, {
			matchers: [linkifyMatcher],
			changeHandlers: [],
			excludeParents: []
		}),
		registerMarkdownShortcuts(editor, typingTransformersFor(options.features)),
		/**
		 * Underline is bound natively by lexical core (Ctrl+U → FORMAT_TEXT_COMMAND)
		 * but has no place in the stored format, so it is swallowed rather than
		 * left to apply a style that silently disappears on save.
		 */
		editor.registerCommand(
			FORMAT_TEXT_COMMAND,
			(format) => format === 'underline',
			COMMAND_PRIORITY_NORMAL
		)
	];

	if (options.features.includes('list')) teardown.push(registerList(editor));

	return {
		editor,
		destroy: () => {
			for (const off of teardown) off();
		}
	};
}
