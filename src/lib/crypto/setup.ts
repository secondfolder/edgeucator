/**
 * The multi-step client flows: first setup, changing a password, and starting
 * again after forgetting one.
 *
 * BROWSER ONLY — see the note at the top of `kdf.ts`.
 *
 * Each of these returns the fields a form action needs and nothing else. They
 * are here rather than in the components so the ordering — which is
 * security-relevant in the change-password case — lives in one testable place.
 */

import { MASTER_KEY_VERSIONS, type KeyWrapParams } from '../encryption';
import { deriveAuthSecret, deriveMasterKey, deriveWrapKey } from './kdf';
import { generateAgeIdentity } from './identity';
import { unwrapIdentity, wrapIdentity } from './wrap';
import type { KeyWrapView } from '../types';

/** The params recorded alongside a password wrap made right now. */
export function currentPasswordWrapParams(): KeyWrapParams {
	const current = MASTER_KEY_VERSIONS[0];
	return {
		type: 'password',
		kdf: current.kdf,
		version: current.version,
		iterations: current.iterations
	};
}

export type IdentitySubmission = {
	authSecret: string;
	recipient: string;
	wrapParams: string;
	wrapBlob: string;
};

/**
 * A brand-new identity, sealed under a brand-new password.
 *
 * Used by signup, by an account that has no keys yet, and by the
 * forgotten-password path — which is the same operation, just with an existing
 * account and the knowledge that the old identity is gone.
 */
export async function buildIdentitySubmission(
	email: string,
	password: string
): Promise<IdentitySubmission & { identity: string }> {
	const master = await deriveMasterKey(password, email, MASTER_KEY_VERSIONS[0]);
	const wrapKey = await deriveWrapKey(master);
	const { identity, recipient } = await generateAgeIdentity();

	return {
		authSecret: await deriveAuthSecret(master),
		recipient,
		wrapParams: JSON.stringify(currentPasswordWrapParams()),
		wrapBlob: await wrapIdentity({ wrapKey, identity, recipient }),
		identity
	};
}

export type PasswordChange = {
	currentAuthSecret: string;
	newAuthSecret: string;
	wrapParams: string;
	wrapBlob: string;
};

/**
 * Re-seals the existing identity under a new password.
 *
 * The order matters and is the reason this is one function rather than steps in
 * a component:
 *
 * 1. Open the existing wrap with the OLD password, locally.
 * 2. Fail here if it does not open — so a wrong current password is caught on
 *    the device, before anything is sent, and the server is never asked to
 *    distinguish "wrong password" from "wrong everything".
 * 3. Only then re-seal under the new one.
 *
 * Returns null when the old password is wrong. The identity itself never
 * changes, so every message ever sent stays readable — which is the whole
 * difference between changing a password and forgetting one.
 */
export async function buildPasswordChange(input: {
	email: string;
	oldPassword: string;
	newPassword: string;
	recipient: string;
	wraps: KeyWrapView[];
}): Promise<PasswordChange | null> {
	const passwordWraps = input.wraps.filter((wrap) => wrap.type === 'password');

	// A loop, because more than one password wrap can legitimately exist: a
	// previous change inserts the new wrap before changing the credential, so a
	// crash mid-change leaves two. Exactly one of them opens.
	let opened: { identity: string; master: Awaited<ReturnType<typeof deriveMasterKey>> } | null =
		null;
	for (const wrap of passwordWraps) {
		if (wrap.params.type !== 'password') continue;
		const master = await deriveMasterKey(input.oldPassword, input.email, {
			version: wrap.params.version,
			kdf: wrap.params.kdf,
			iterations: wrap.params.iterations
		});
		const identity = await unwrapIdentity({
			wrapKey: await deriveWrapKey(master),
			blob: wrap.blob,
			recipient: input.recipient
		});
		if (identity) {
			opened = { identity, master };
			break;
		}
	}
	if (!opened) return null;

	const newMaster = await deriveMasterKey(input.newPassword, input.email, MASTER_KEY_VERSIONS[0]);
	const newWrapKey = await deriveWrapKey(newMaster);

	return {
		currentAuthSecret: await deriveAuthSecret(opened.master),
		newAuthSecret: await deriveAuthSecret(newMaster),
		wrapParams: JSON.stringify(currentPasswordWrapParams()),
		wrapBlob: await wrapIdentity({
			wrapKey: newWrapKey,
			identity: opened.identity,
			recipient: input.recipient
		})
	};
}
