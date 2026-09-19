import { z } from 'zod';
import {
	MAX_CIPHERTEXT_BYTES,
	MAX_REACTIONS_PER_MESSAGE,
	MAX_REACTION_CIPHERTEXT_BYTES,
	RESTORE_PAGE_SIZE,
	THREAD_ICONS
} from '$lib/messaging';

/**
 * What the browser posts when sending a message.
 *
 * Note what this validates and what it cannot. It checks the *envelope* — the
 * icon is one of a closed list, the body is base64 within a bound — and never
 * the content, because the content is ciphertext the server cannot read. Both
 * the endpoint and the client import these, so the client refuses before
 * spending a network round trip on 25 MB.
 *
 * This feature does not use superforms, and that is deliberate rather than an
 * omission: superforms exists to bind a `SuperValidated` to a `<form>` and
 * re-render errors from an action, and there is no action here. The body has to
 * be built in the browser because only the browser can encrypt it, so sending
 * is a `fetch` to a `+server.ts`. Zod still does the validating.
 */

export const threadIconSchema = z.enum(THREAD_ICONS);

/**
 * Standard base64, not base64url: this goes straight into a `ciphertext`
 * column. The charset check also catches a plaintext body posted by mistake,
 * since prose contains spaces and newlines.
 */
const ciphertextSchema = z
	.string()
	.min(1, 'Nothing to send')
	.max(MAX_CIPHERTEXT_BYTES, 'That message is too long')
	.regex(/^[A-Za-z0-9+/=]+$/, 'Malformed message');

const optionalCiphertextSchema = z.preprocess(
	(value) => (value === null || value === undefined || value === '' ? undefined : value),
	ciphertextSchema.optional()
);

export const newThreadSchema = z.object({
	icon: threadIconSchema,
	ciphertext: ciphertextSchema,
	metadataCiphertext: optionalCiphertextSchema
});

export const replySchema = z.object({
	ciphertext: ciphertextSchema,
	metadataCiphertext: optionalCiphertextSchema
});

const reactionCiphertextSchema = ciphertextSchema.max(
	MAX_REACTION_CIPHERTEXT_BYTES,
	'That reaction is too long'
);

export const reactionSchema = z.object({ ciphertext: reactionCiphertextSchema });

export const messageMetadataSchema = z.object({ metadataCiphertext: ciphertextSchema });

/**
 * One page of a partner-assisted history restore.
 *
 * `RESTORE_PAGE_SIZE` is the server's own page size, so a client cannot send
 * back more rows than it could have been given. The ids are checked as UUIDs
 * rather than free strings because they go into a `WHERE id = ?` — the query is
 * parameterised either way, but a shape check here turns a client bug into a
 * 400 instead of a silent no-op update.
 */
const restoreRowSchema = z.object({
	id: z.string().uuid('Malformed id'),
	ciphertext: ciphertextSchema,
	metadataCiphertext: z.union([ciphertextSchema, z.null()]).optional()
});

export const restoreApplySchema = z.object({
	requestId: z.string().uuid('Malformed request id'),
	messages: z.array(restoreRowSchema).max(RESTORE_PAGE_SIZE, 'Too many messages at once'),
	reactions: z
		.array(restoreRowSchema.extend({ ciphertext: reactionCiphertextSchema }))
		.max(RESTORE_PAGE_SIZE * MAX_REACTIONS_PER_MESSAGE, 'Too many reactions at once')
		.default([]),
	/** The last page closes the request, so the requester stops being prompted. */
	final: z.boolean()
});

/**
 * LEGACY-RICHTEXT — one batch of converted message bodies.
 *
 * Reuses `restoreRowSchema`: the payload is the same shape as a history
 * restore, because it is the same operation — replace a body's ciphertext —
 * with a different authorisation rule. Bounded by `RESTORE_PAGE_SIZE` for the
 * same reason. Deleted with the rest; see docs/temporary-code.md.
 */
export const legacyBodiesSchema = z.object({
	messages: z.array(restoreRowSchema).max(RESTORE_PAGE_SIZE, 'Too many messages at once')
});

export const restoreDeclineSchema = z.object({
	requestId: z.string().uuid('Malformed request id')
});

export type NewThreadInput = z.infer<typeof newThreadSchema>;
export type ReplyInput = z.infer<typeof replySchema>;
export type RestoreApplyInput = z.infer<typeof restoreApplySchema>;
