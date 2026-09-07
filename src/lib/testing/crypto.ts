/**
 * Frozen key material for tests that need a recipient or a wrap but are not
 * testing cryptography.
 *
 * These are real age X25519 keypairs, generated once and pasted in rather than
 * produced per test. Two reasons: the real KDF is 650,000 PBKDF2 iterations,
 * and a server test that ran it would pay ~85 ms for coverage it does not add;
 * and a stable recipient makes an assertion about *which* recipient came back
 * readable. Being real rather than plausible matters because a recipient is
 * bech32 with a checksum, so a hand-made one would fail any validation that
 * gets added later.
 *
 * These are test fixtures and nothing else — they protect no real data. The
 * genuine crypto is covered in `src/lib/crypto/*.test.ts`, where it belongs.
 */

export const ADA_IDENTITY =
	'AGE-SECRET-KEY-1LFE7AT24U65H34MW2E3Y6APRMKHKTF3XW0PP958PUQ07KP8UWPXQD6PDM7';
export const ADA_RECIPIENT = 'age19kvptgg9mxj0k9nk3hjppfhpuzglys60nfzjafm845j8ge8n0snsd3wfrv';

export const JUN_IDENTITY =
	'AGE-SECRET-KEY-1S007N3T56ZXP4FCWC8HL45TXQ5A56KNLZ0M9J59R92HGEGHN3RQSKRJKYL';
export const JUN_RECIPIENT = 'age1as7ft8l0hdgkg5p70j96r65zjkzg3td0urau0x6x4qdcdmykp3usyh0wre';

/** Someone in neither partnership, for "and nobody else" assertions. */
export const STRANGER_IDENTITY =
	'AGE-SECRET-KEY-1WTVHECQLF3NNA758ZYAKP2N4XFKNLLLYR92VDRJ4FL0QHNXWQ3MSX4PXV9';
export const STRANGER_RECIPIENT = 'age1j9df3qwykfpj9ny945uw77evzea2jv8efvtr2u7sl77z67jsfeas7vyxlz';

/**
 * An opaque wrap blob. Never opened by anything server-side, so it does not
 * have to decrypt to anything — it only has to be base64url of plausible
 * length, which is all the Zod field checks.
 */
export const FAKE_WRAP_BLOB =
	'AAAAAAAAAAAAAAAAJmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZg';

export const PASSWORD_WRAP_PARAMS = {
	type: 'password',
	kdf: 'PBKDF2-SHA256',
	version: 1,
	iterations: 650_000
} as const;
