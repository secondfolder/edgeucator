/**
 * Handing an invite link to the user's own sharing UI.
 *
 * Both of the entry points that use this want the same thing: get the link onto
 * the clipboard *and* open the native share sheet if there is one. The clipboard
 * write happens first and unconditionally, so that dismissing the share sheet
 * still leaves the user holding the link.
 */

export type ShareOutcome = {
	copied: boolean;
	/** True only when the platform sheet actually completed a share. */
	shared: boolean;
};

/**
 * `navigator.share` needs transient user activation, which is consumed by the
 * first await. The clipboard write is therefore fired but not awaited before
 * the share call — awaiting it first is enough to make Safari reject the share
 * with NotAllowedError.
 */
export async function shareInviteLink(
	url: string,
	title = 'Partner invite'
): Promise<ShareOutcome> {
	const copying = writeClipboard(url);

	let shared = false;
	if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
		try {
			await navigator.share({ title, url });
			shared = true;
		} catch (error) {
			// Dismissing the sheet throws AbortError. That is a normal outcome, not
			// a failure worth surfacing — the link is on the clipboard either way.
			if (!(error instanceof DOMException && error.name === 'AbortError')) {
				console.warn('Share failed, falling back to the clipboard', error);
			}
		}
	}

	return { copied: await copying, shared };
}

/**
 * Clipboard access needs a secure context, can be refused outright, and — when
 * the document is not focused — can leave its promise pending forever rather
 * than rejecting. Callers navigate once this resolves, so it is capped: a page
 * that never moves on is worse than a link that did not get copied.
 */
const CLIPBOARD_TIMEOUT_MS = 2000;

async function writeClipboard(text: string): Promise<boolean> {
	if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return false;
	try {
		return await Promise.race([
			navigator.clipboard.writeText(text).then(() => true),
			new Promise<boolean>((resolve) => setTimeout(() => resolve(false), CLIPBOARD_TIMEOUT_MS))
		]);
	} catch {
		return false;
	}
}
