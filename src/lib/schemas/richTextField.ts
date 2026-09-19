import { z } from 'zod';
import { documentToPlainText, isRichTextDocumentEmpty, parseRichTextDocument } from '$lib/richtext';

/**
 * A freetext form field that holds a rich-text document.
 *
 * Two things this does that a plain `z.string().max(n)` cannot, and both are
 * the reason it exists:
 *
 * 1. **The length limit counts visible text.** The stored value is a Lexical
 *    document — JSON several times the size of the prose inside it — so
 *    measuring the string would refuse a two-sentence description.
 *
 * 2. **It is the sanitiser.** The value stored is the schema's *output*, not
 *    its input. `parseRichTextDocument` strips every key the document schema
 *    does not declare, which matters because Lexical deliberately preserves
 *    unrecognised node state (a node's `$` key) so other plugins' data
 *    survives a round trip. Without this, anyone could POST a description
 *    carrying arbitrary JSON and we would store it verbatim — invariant 14,
 *    the same reasoning as re-checking the thread icon on the server.
 *
 * An empty document and an empty string both become `null`, so "no
 * description" has one representation in the database rather than two.
 */
export function richTextFieldSchema(maxChars: number) {
	const tooLong = `Please keep this to ${maxChars} characters or fewer`;

	return z
		.string()
		.transform((raw, ctx) => {
			const trimmed = raw.trim();
			if (trimmed === '') return null;

			const document = parseRichTextDocument(trimmed);
			if (document) {
				if (documentToPlainText(document).length > maxChars) {
					ctx.addIssue({ code: 'custom', message: tooLong });
					return z.NEVER;
				}
				if (isRichTextDocumentEmpty(document)) return null;
				// The stripped form: smaller than what the editor emitted, and
				// carrying nothing we did not ask for.
				return JSON.stringify(document);
			}

			/**
			 * LEGACY-RICHTEXT — a plain-text description, either from a row written
			 * before rich text or from a client that has not reloaded. Accepted on
			 * the same terms it always was. Delete this branch with the rest of the
			 * legacy handling; see docs/temporary-code.md.
			 */
			if (trimmed.length > maxChars) {
				ctx.addIssue({ code: 'custom', message: tooLong });
				return z.NEVER;
			}
			return trimmed;
		})
		.nullable()
		.default(null);
}
