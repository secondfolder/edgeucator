import { z } from 'zod';
import { MAX_CIPHERTEXT_BYTES, MAX_REACTION_CIPHERTEXT_BYTES, THREAD_ICONS } from '$lib/messaging';

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

export const newThreadSchema = z.object({
	icon: threadIconSchema,
	ciphertext: ciphertextSchema
});

export const replySchema = z.object({ ciphertext: ciphertextSchema });

export const reactionSchema = z.object({
	ciphertext: ciphertextSchema.max(MAX_REACTION_CIPHERTEXT_BYTES, 'That reaction is too long')
});

export type NewThreadInput = z.infer<typeof newThreadSchema>;
export type ReplyInput = z.infer<typeof replySchema>;
