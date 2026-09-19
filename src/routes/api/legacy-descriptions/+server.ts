import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { richTextDocumentSchema } from '$lib/richtext';
import { migrateLegacyDescriptions } from '$lib/server/richtext-legacy';
import type { RequestHandler } from './$types';

/**
 * LEGACY-RICHTEXT — accepts converted copies of pre-rich-text descriptions.
 *
 * This endpoint and its route directory are deleted with the rest; see
 * docs/temporary-code.md.
 *
 * The client says which rows it converted. It does **not** get to say whether
 * it was allowed to: `migrateLegacyDescriptions` re-checks ownership and
 * control against the database for every row, and refuses any row already
 * converted. Invariant 14.
 */
const updateSchema = z.object({
	kind: z.enum(['self-task', 'self-reward', 'partnership-task', 'partnership-reward']),
	id: z.string().uuid('Malformed id'),
	partnershipId: z.string().uuid('Malformed partnership id').optional(),
	/**
	 * Parsed, not merely checked: the stored value is the schema's output, which
	 * is what strips node state and anything else undeclared.
	 */
	description: z.string().transform((raw, ctx) => {
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			ctx.addIssue({ code: 'custom', message: 'Malformed description' });
			return z.NEVER;
		}
		const checked = richTextDocumentSchema.safeParse(parsed);
		if (!checked.success) {
			ctx.addIssue({ code: 'custom', message: 'Malformed description' });
			return z.NEVER;
		}
		return JSON.stringify(checked.data);
	})
});

const bodySchema = z.object({ updates: z.array(updateSchema).max(200, 'Too many at once') });

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) error(401, 'Not signed in');

	const parsed = bodySchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, parsed.error.issues[0]?.message ?? 'Malformed request');

	const updated = await migrateLegacyDescriptions(locals.db, locals.user.id, parsed.data.updates);
	return json({ ok: true, updated });
};
