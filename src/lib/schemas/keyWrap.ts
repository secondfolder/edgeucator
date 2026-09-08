import { z } from 'zod';
import { AUTH_SECRET_LENGTH, MAX_WRAP_PARAMS_LENGTH, parseKeyWrapParams } from '$lib/encryption';
import { RECIPIENT_PATTERN } from '$lib/crypto/identity';

/**
 * The fields the browser posts in place of a password, shared by every form
 * that has to derive keys.
 *
 * Note what the server can and cannot check here. It never receives a
 * password, so it cannot validate one — length, strength, confirmation, all of
 * it is now structurally client-side. What it *can* check is that these fields
 * look like the output of the client KDF, and that is all these do.
 *
 * That is not the thing AGENTS.md invariant 14 forbids. The invariant is about
 * a *permission* being enforced by a disabled input; this is a policy that has
 * genuinely moved off the server, deliberately, and cannot be moved back
 * without giving up the property the whole feature exists for. See
 * docs/encryption.md. The compensating server-side control is rate limiting.
 */

/**
 * 32 bytes of HKDF output as unpadded base64url — 43 characters.
 *
 * A single `.regex()` rather than a length check plus a charset check, so that
 * the empty string produces exactly one message, and that message names the
 * real cause: an empty value means the browser never ran the KDF at all.
 */
export const authSecretField = z
	.string()
	.regex(
		new RegExp(`^[A-Za-z0-9_-]{${AUTH_SECRET_LENGTH}}$`),
		'JavaScript must be enabled to sign in — your password is turned into a key in your browser and is never sent to the server.'
	);

/** An age recipient. Public by design, so this is a shape check and nothing more. */
export const recipientField = z.string().regex(RECIPIENT_PATTERN, 'Malformed encryption key');

/** base64url of `IV || AES-256-GCM ciphertext || tag`. Opaque to the server. */
export const wrapBlobField = z.string().regex(/^[A-Za-z0-9_-]{40,1024}$/, 'Malformed key wrap');

/**
 * How the browser derives the unwrapping key, as JSON.
 *
 * A JSON *string* rather than a nested Zod object because this arrives through
 * FormData, where a nested object would need dotted field names for no gain —
 * the server does not read the contents.
 */
export const wrapParamsField = z
	.string()
	.max(MAX_WRAP_PARAMS_LENGTH)
	.refine((raw) => parseKeyWrapParams(raw) !== null, 'Malformed key wrap parameters');

/** The three fields that together record a new identity. */
export const identityFields = {
	recipient: recipientField,
	wrapParams: wrapParamsField,
	wrapBlob: wrapBlobField
} as const;
