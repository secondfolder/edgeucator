import { describe, expect, it } from 'vitest';
import { IS_BOLD, IS_CODE, IS_ITALIC, IS_STRIKETHROUGH, IS_UNDERLINE, createEditor } from 'lexical';
import { RICH_TEXT_NODES } from './richtext-editor';
import {
	FORMAT_BOLD,
	FORMAT_CODE,
	FORMAT_ITALIC,
	FORMAT_STRIKETHROUGH,
	FORMAT_UNDERLINE,
	documentEmbedUrls,
	documentToPlainText,
	isRichTextDocumentEmpty,
	parseRichTextDocument,
	parseStoredRichText,
	richTextDocumentSchema,
	type RichTextDocument
} from './richtext';

function doc(children: RichTextDocument['root']['children']): RichTextDocument {
	return { root: { type: 'root', children } };
}

function text(value: string, format = 0) {
	return { type: 'text' as const, text: value, format };
}

describe('format bits', () => {
	/**
	 * `richtext.ts` mirrors these rather than importing Lexical, so that the
	 * read path stays library-free. This test is what makes the mirror safe:
	 * a Lexical upgrade that renumbered them would otherwise silently un-bold
	 * every message ever written.
	 */
	it('match the values Lexical actually uses', () => {
		expect(FORMAT_BOLD).toBe(IS_BOLD);
		expect(FORMAT_ITALIC).toBe(IS_ITALIC);
		expect(FORMAT_STRIKETHROUGH).toBe(IS_STRIKETHROUGH);
		expect(FORMAT_UNDERLINE).toBe(IS_UNDERLINE);
		expect(FORMAT_CODE).toBe(IS_CODE);
	});
});

describe('parseRichTextDocument', () => {
	it('reads a document Lexical produced', () => {
		const stored = JSON.stringify(doc([{ type: 'paragraph', children: [text('hello', 1)] }]));
		expect(parseRichTextDocument(stored)).toEqual(
			doc([{ type: 'paragraph', children: [text('hello', 1)] }])
		);
	});

	it('returns null for legacy plain text rather than throwing', () => {
		expect(parseRichTextDocument('just some words')).toBeNull();
		expect(parseRichTextDocument('{"root": broken')).toBeNull();
	});

	/**
	 * The sanitisation step. Lexical preserves unrecognised node state (a
	 * node's `$` key) verbatim so other plugins' data survives a round trip,
	 * which would make any description column an unbounded arbitrary-data
	 * channel. Storing the *parsed* value is what closes that.
	 */
	it('strips node state and any other undeclared key', () => {
		const hostile = {
			root: {
				type: 'root',
				children: [
					{
						type: 'paragraph',
						children: [
							{
								type: 'autolink',
								url: 'https://example.com/a',
								isUnlinked: false,
								$: { junk: 'x'.repeat(1000) },
								children: [text('https://example.com/a')]
							}
						]
					}
				]
			}
		};
		const parsed = parseRichTextDocument(JSON.stringify(hostile));
		expect(JSON.stringify(parsed)).not.toContain('junk');
		expect(JSON.stringify(parsed)).not.toContain('$');
	});

	it('rejects a node type outside the closed set', () => {
		const stored = JSON.stringify({
			root: { type: 'root', children: [{ type: 'heading', tag: 'h1', children: [] }] }
		});
		expect(parseRichTextDocument(stored)).toBeNull();
	});

	it('accepts the shape Lexical emits for a list', () => {
		const stored = JSON.stringify(
			doc([
				{
					type: 'list',
					listType: 'number',
					start: 3,
					children: [{ type: 'listitem', value: 3, children: [text('three')] }]
				}
			])
		);
		expect(richTextDocumentSchema.safeParse(JSON.parse(stored)).success).toBe(true);
	});
});

describe('documentToPlainText', () => {
	it('drops formatting and keeps the prose', () => {
		expect(
			documentToPlainText(
				doc([{ type: 'paragraph', children: [text('bold', 1), text(' and plain')] }])
			)
		).toBe('bold and plain');
	});

	it('reads a link by its label, not its href', () => {
		expect(
			documentToPlainText(
				doc([
					{
						type: 'paragraph',
						children: [
							text('see '),
							{ type: 'link', url: 'https://example.com/x', children: [text('the page')] }
						]
					}
				])
			)
		).toBe('see the page');
	});

	it('joins line breaks, paragraphs and list items with newlines', () => {
		expect(
			documentToPlainText(
				doc([
					{ type: 'paragraph', children: [text('one'), { type: 'linebreak' }, text('two')] },
					{
						type: 'list',
						listType: 'bullet',
						start: 1,
						children: [
							{ type: 'listitem', value: 1, children: [text('a')] },
							{ type: 'listitem', value: 2, children: [text('b')] }
						]
					}
				])
			)
		).toBe('one\ntwo\na\nb');
	});

	/** Length limits count this, so an embed must not inflate them. */
	it('ignores embed nodes', () => {
		expect(
			documentToPlainText(
				doc([
					{ type: 'embed', url: 'https://i.imgur.com/cat.jpg' },
					{ type: 'paragraph', children: [text('look')] }
				])
			)
		).toBe('look');
	});
});

describe('documentEmbedUrls', () => {
	it('lists embed nodes in order, deduplicated', () => {
		expect(
			documentEmbedUrls(
				doc([
					{ type: 'embed', url: 'https://a.test/1' },
					{ type: 'paragraph', children: [text('x')] },
					{ type: 'embed', url: 'https://a.test/2' },
					{ type: 'embed', url: 'https://a.test/1' }
				])
			)
		).toEqual(['https://a.test/1', 'https://a.test/2']);
	});

	it('does not report a link that is merely embeddable', () => {
		expect(
			documentEmbedUrls(
				doc([
					{
						type: 'paragraph',
						children: [
							{
								type: 'autolink',
								url: 'https://i.imgur.com/cat.jpg',
								children: [text('https://i.imgur.com/cat.jpg')]
							}
						]
					}
				])
			)
		).toEqual([]);
	});
});

describe('isRichTextDocumentEmpty', () => {
	it('is true for an untouched editor', () => {
		expect(isRichTextDocumentEmpty(doc([]))).toBe(true);
		expect(isRichTextDocumentEmpty(doc([{ type: 'paragraph', children: [] }]))).toBe(true);
	});

	it('is false for a message that is only an embed', () => {
		expect(
			isRichTextDocumentEmpty(doc([{ type: 'embed', url: 'https://i.imgur.com/cat.jpg' }]))
		).toBe(false);
	});
});

/* ── LEGACY-RICHTEXT — delete with the legacy reader ─────────────────────── */

describe('parseStoredRichText, legacy plain text', () => {
	it('reads plain prose as one paragraph', () => {
		expect(parseStoredRichText('just some words')).toEqual(
			doc([{ type: 'paragraph', children: [text('just some words')] }])
		);
	});

	it('keeps single newlines as line breaks and blank lines as paragraphs', () => {
		expect(parseStoredRichText('one\ntwo\n\nthree')).toEqual(
			doc([
				{ type: 'paragraph', children: [text('one'), { type: 'linebreak' }, text('two')] },
				{ type: 'paragraph', children: [text('three')] }
			])
		);
	});

	it('auto-links a bare URL the way the old renderer did', () => {
		const result = parseStoredRichText('see https://example.com/page now');
		expect(result.root.children).toEqual([
			{
				type: 'paragraph',
				children: [
					text('see '),
					{
						type: 'autolink',
						url: 'https://example.com/page',
						isUnlinked: false,
						children: [text('https://example.com/page')]
					},
					text(' now')
				]
			}
		]);
	});

	it('links a www URL, which is why linkifyjs is kept rather than a regex', () => {
		const [block] = parseStoredRichText('go to www.example.com today').root.children;
		expect(block).toMatchObject({
			children: [{}, { type: 'autolink', url: 'http://www.example.com' }, {}]
		});
	});

	it('never links a javascript: scheme', () => {
		expect(parseStoredRichText('click javascript:alert(1) here')).toEqual(
			doc([{ type: 'paragraph', children: [text('click javascript:alert(1) here')] }])
		);
	});

	/**
	 * The migration's headline behaviour: every URL a provider supports gets an
	 * embed, with no cap, because message bodies already rendered with an
	 * unlimited embed budget. This is what makes a converted message look like
	 * it did before rather than approximately like it.
	 */
	it('gives every supported URL an embed, above the paragraph that holds it', () => {
		const result = parseStoredRichText(
			'first https://i.imgur.com/a.jpg\n\nthen https://www.redgifs.com/watch/abc and https://youtu.be/dQw4w9WgXcQ'
		);
		expect(result.root.children.map((block) => block.type)).toEqual([
			'embed',
			'paragraph',
			'embed',
			'embed',
			'paragraph'
		]);
		expect(documentEmbedUrls(result)).toEqual([
			'https://i.imgur.com/a.jpg',
			'https://www.redgifs.com/watch/abc',
			'https://youtu.be/dQw4w9WgXcQ'
		]);
	});

	it('leaves a host with no provider as a plain link and no embed', () => {
		const result = parseStoredRichText('read https://example.com/article');
		expect(result.root.children.map((block) => block.type)).toEqual(['paragraph']);
		expect(documentEmbedUrls(result)).toEqual([]);
	});

	it('embeds the same URL once per paragraph, not once per mention', () => {
		const result = parseStoredRichText(
			'https://i.imgur.com/a.jpg and again https://i.imgur.com/a.jpg'
		);
		expect(result.root.children.filter((block) => block.type === 'embed')).toHaveLength(1);
	});

	it('is idempotent once converted: a converted document parses back unchanged', () => {
		const converted = parseStoredRichText('see https://i.imgur.com/a.jpg');
		expect(parseStoredRichText(JSON.stringify(converted))).toEqual(converted);
	});
});

describe('the stored shape', () => {
	/**
	 * The golden file.
	 *
	 * Our data format is Lexical's own serialisation, and Lexical ships breaking
	 * changes on minor versions — the `version` field on every serialised node
	 * exists because the shape evolves. This asserts that a document written
	 * today still loads into a real Lexical editor and comes back out meaning
	 * the same thing.
	 *
	 * If this fails after a Lexical upgrade, **do not just update the fixture.**
	 * Every message and description already in the database is in the old shape,
	 * so a change here is a migration, not a test edit.
	 */
	const GOLDEN: RichTextDocument = doc([
		{ type: 'embed', url: 'https://i.imgur.com/cat.jpg' },
		{
			type: 'paragraph',
			children: [
				text('plain '),
				text('bold', 1),
				text('italic', 2),
				text('struck', 4),
				text('code', 16),
				text('both', 3),
				{ type: 'linebreak' },
				{
					type: 'autolink',
					url: 'https://i.imgur.com/cat.jpg',
					isUnlinked: false,
					children: [text('https://i.imgur.com/cat.jpg')]
				},
				{ type: 'link', url: 'https://example.com/x', children: [text('labelled')] }
			]
		},
		{
			type: 'list',
			listType: 'bullet',
			start: 1,
			children: [{ type: 'listitem', value: 1, children: [text('a bullet')] }]
		},
		{
			type: 'list',
			listType: 'number',
			start: 2,
			children: [{ type: 'listitem', value: 2, children: [text('a number')] }]
		}
	]);

	it('survives a round trip through a real Lexical editor unchanged', () => {
		const editor = createEditor({
			nodes: [...RICH_TEXT_NODES],
			onError: (error) => {
				throw error;
			}
		});
		(editor as unknown as { _headless: boolean })._headless = true;
		editor.setEditorState(editor.parseEditorState(JSON.stringify(GOLDEN)));

		const reserialised = richTextDocumentSchema.safeParse(editor.getEditorState().toJSON());
		expect(reserialised.success).toBe(true);
		if (!reserialised.success) return;
		expect(reserialised.data).toEqual(GOLDEN);
	});

	it('reads back as the prose it holds', () => {
		expect(documentToPlainText(GOLDEN)).toBe(
			'plain bolditalicstruckcodeboth\nhttps://i.imgur.com/cat.jpglabelled\na bullet\na number'
		);
		expect(documentEmbedUrls(GOLDEN)).toEqual(['https://i.imgur.com/cat.jpg']);
	});
});
