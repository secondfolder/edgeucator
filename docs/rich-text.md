# Rich text

Messages, task descriptions and reward descriptions are rich text. Formatting
is typed rather than clicked: `*bold*`, `_italic_`, `~struck~`, `` `code` ``,
plus `Ctrl+B`/`I`. Messages have no toolbar at all, the way a chat box should
not; descriptions get a floating toolbar when you select something.

This document is the format and where each half of it lives. The editor is
[Lexical](https://lexical.dev). Messages are encrypted before they are stored —
that is [docs/encryption.md](encryption.md) — and embeds are
[docs/embeds.md](embeds.md).

## The format is Lexical's own serialisation

What gets stored is `editorState.toJSON()`. Not markdown, not HTML, not a shape
of our own. Lexical is the editor, so Lexical defines the document, and a link
is serialised however Lexical serialises a link.

```json
{
	"root": {
		"type": "root",
		"children": [
			{ "type": "embed", "url": "https://i.imgur.com/cat.jpg" },
			{
				"type": "paragraph",
				"children": [
					{ "type": "text", "text": "look ", "format": 0 },
					{
						"type": "autolink",
						"url": "https://i.imgur.com/cat.jpg",
						"isUnlinked": false,
						"children": [{ "type": "text", "text": "https://i.imgur.com/cat.jpg", "format": 0 }]
					}
				]
			}
		]
	}
}
```

Three consequences worth knowing, because they are why this was chosen over
storing markdown:

- **There is no dialect.** Markdown exists only as _typing shortcuts_. Nothing
  parses markdown when reading, so there is no round-trip to get wrong and no
  escaping: type `5 * 3 * 2` and that is exactly what is stored and shown. A
  markdown-backed editor would have rewritten it to `5 \* 3 \* 2` the first
  time anyone edited it.
- **Reading needs no editor.** The serialised state is plain JSON, so
  `RichText.svelte` walks it directly. A page that only displays descriptions
  ships none of Lexical, and the server bundle contains none of it either —
  check with `grep -rl lexical .svelte-kit/output/server` after a build.
- **It costs bytes.** A document is roughly five times the prose inside it, and
  the stored form is the _validated_ form precisely because that strips
  Lexical's default-valued noise and halves it again. Message bodies are
  encrypted and stored in D1, which bills on size, and `MAX_CIPHERTEXT_BYTES`
  (64 KB) has less headroom than it used to.

### Every length limit counts visible text

`MAX_BODY_CHARS` (4,000) and the 500-character description limit are limits on
prose, measured with `documentToPlainText`. Counting the stored string would
call an empty editor full and cut people off after a few hundred typed
characters. A message over the limit is **refused, not truncated** — a document
cannot be cut at a character offset without corrupting it.

## Where the halves live

| File                                              | Role                                                                                           |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `src/lib/richtext.ts`                             | The document type, its Zod schema, and the read helpers. **Imports no Lexical, and must not.** |
| `src/lib/richtext-editor.ts`                      | The Lexical half: node set, typing shortcuts, the link matcher, `EmbedNode`.                   |
| `src/lib/components/RichText.svelte`              | Renders a stored document. Walks JSON; no `{@html}`.                                           |
| `src/lib/components/RichTextEditor.svelte`        | The editor, in both moods.                                                                     |
| `src/lib/components/FloatingFormatToolbar.svelte` | The selection toolbar, for descriptions only.                                                  |
| `src/lib/schemas/richTextField.ts`                | The form field: validates, sanitises, limits.                                                  |

The split in the first two rows is load-bearing. A Lexical import in
`richtext.ts` puts the whole editor back on every page that shows a
description.

## The closed node set

`paragraph`, `text`, `linebreak`, `link`, `autolink`, `list`, `listitem`,
`embed`. A node type that is not registered in `RICH_TEXT_NODES` cannot be
created, and one that is not in `richTextDocumentSchema` cannot be stored —
the same guarantee enforced from both ends. There are deliberately no
headings, quotes or code blocks.

Messages allow a narrower set still (`MESSAGE_FEATURES`): no lists, because a
chat box that turns "- " into a bullet because someone started a line with a
dash is a worse chat box.

### Lexical details that have to be honoured

**`isUnlinked`.** An `AutoLinkNode` maintains `text === url`: edit the text and
Lexical retargets the URL or unwraps the node entirely. `isUnlinked: true` is
its escape hatch for "I removed this link from something that still looks like
a URL". Such a node renders as **plain text** — anything else silently
re-links what somebody deliberately unlinked.

**`format` is a bitfield**, not nested nodes: bold-and-italic is one text node
with two bits set. `richtext.ts` mirrors Lexical's constants rather than
importing them, and `richtext.test.ts` asserts the mirror still matches, so a
renumbering in a Lexical upgrade fails a test instead of silently un-bolding
every message ever written.

**The editor needs a `theme` for that bitfield to be visible.** Lexical draws a
text node as a _single_ tag — `strong` for bold, `em` for italic, `span`
otherwise — so bold-and-italic is `<strong>` alone and strikethrough is a bare
`<span>`. Every format past the first one is carried by a theme class, styled
through `:global()` in `RichTextEditor.svelte`. Without it the document is
right and the screen is wrong, which is a confusing way to lose a format. The
theme therefore covers exactly the formats that have no tag of their own: not
`code`, which Lexical gives a real `<code>` element, and not `underline`, which
is not part of the stored format at all.

## Embeds are blocks, not link properties

A link carries no embed information. An embed is its own block node, inserted
**above the paragraph containing the link** once the caret leaves a finished
auto-link — typing a space after it, clicking away, blurring the field.

The point of making it a real block is that **opting out is deletion**: a
sender who does not want the embed selects it and presses backspace. There is
no stored flag and no opt-out UI, because the editor already has one.

Two things follow:

- Insertion is idempotent, and only happens when `embedSpecFor(url)` resolves.
  A host with no provider stays a plain link.
- Because the decision is made while authoring, **adding a provider later does
  not retroactively embed old content.** A document without an `EmbedNode` has
  no embed, whatever `embedSpecFor` learns afterwards. The one exception is the
  legacy migration, which embeds every supported URL it finds.

`embedSpecFor` still runs at render rather than being stored, so _dropping_ a
provider degrades an embed to its link instead of leaving a hole.

## Security

**No `{@html}`, ever.** Every character of user prose goes through ordinary
Svelte interpolation and real elements, so the XSS surface is zero. The one
sanitised `{@html}` in the app is inside `UrlEmbed`, and only ever sees
DOMPurify-cleaned oEmbed markup. This is why the renderer walks the document
itself instead of using `@lexical/html`, which returns an HTML string.

**Descriptions are validated server-side.** They arrive as client-supplied
JSON, so `richTextFieldSchema` parses them and **stores its own output**. That
is the sanitisation step: Lexical deliberately preserves unrecognised node
state (a node's `$` key) verbatim so other plugins' data survives a round trip,
which would otherwise make a description column an unbounded arbitrary-data
channel. Invariant 14, the same reasoning as re-checking the thread icon.

Message bodies need no such check — the server holds only ciphertext, and a
sender could always put anything in their own message.

**URLs are checked twice**: `isSafeHttpUrl` on the way in, and again at render
before an `href` reaches the DOM.

## Legacy content

Everything written before this change is a plain string. That is handled by one
boundary function, `parseStoredRichText`, and is **temporary** — see
[docs/temporary-code.md](temporary-code.md) for the removal contract.
