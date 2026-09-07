import { afterEach, describe, expect, test, vi } from 'vitest';
import { shareInviteLink } from './share';

/**
 * Runs in the node project with a stubbed `navigator` rather than in jsdom:
 * jsdom implements neither `navigator.share` nor `navigator.clipboard`, so it
 * would have to be stubbed there too, and this way the test says exactly which
 * platform capability each case is about.
 */

const URL_UNDER_TEST = 'https://app.test/invite/abc123';

function stubNavigator(parts: { share?: unknown; clipboard?: unknown }) {
	vi.stubGlobal('navigator', parts);
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

test('opens the share sheet and copies, when both are available', async () => {
	const share = vi.fn().mockResolvedValue(undefined);
	const writeText = vi.fn().mockResolvedValue(undefined);
	stubNavigator({ share, clipboard: { writeText } });

	expect(await shareInviteLink(URL_UNDER_TEST)).toEqual({ copied: true, shared: true });
	expect(share).toHaveBeenCalledWith({ title: 'Partner invite', url: URL_UNDER_TEST });
	expect(writeText).toHaveBeenCalledWith(URL_UNDER_TEST);
});

test('copies even when there is no share sheet', async () => {
	const writeText = vi.fn().mockResolvedValue(undefined);
	stubNavigator({ clipboard: { writeText } });

	expect(await shareInviteLink(URL_UNDER_TEST)).toEqual({ copied: true, shared: false });
	expect(writeText).toHaveBeenCalledWith(URL_UNDER_TEST);
});

test('starts the clipboard write before awaiting the share sheet', async () => {
	// Awaiting the clipboard first consumes the transient user activation that
	// navigator.share needs, and Safari then rejects the share outright.
	const order: string[] = [];
	stubNavigator({
		share: vi.fn(async () => {
			order.push('share');
		}),
		clipboard: {
			writeText: vi.fn(async () => {
				order.push('clipboard');
			})
		}
	});

	await shareInviteLink(URL_UNDER_TEST);
	expect(order[0]).toBe('clipboard');
});

describe('when the user dismisses the share sheet', () => {
	test('reports it as not shared, without logging a warning', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		stubNavigator({
			share: vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError')),
			clipboard: { writeText: vi.fn().mockResolvedValue(undefined) }
		});

		// Dismissing is a normal outcome, and the link is on the clipboard.
		expect(await shareInviteLink(URL_UNDER_TEST)).toEqual({ copied: true, shared: false });
		expect(warn).not.toHaveBeenCalled();
	});
});

test('warns but still reports the copy when the share sheet genuinely fails', async () => {
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	stubNavigator({
		share: vi.fn().mockRejectedValue(new Error('boom')),
		clipboard: { writeText: vi.fn().mockResolvedValue(undefined) }
	});

	expect(await shareInviteLink(URL_UNDER_TEST)).toEqual({ copied: true, shared: false });
	expect(warn).toHaveBeenCalled();
});

test('reports a refused clipboard rather than throwing', async () => {
	// The Clipboard API needs a secure context and can be denied; the page
	// falls back to telling the user to select the link by hand.
	stubNavigator({ clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
	expect(await shareInviteLink(URL_UNDER_TEST)).toEqual({ copied: false, shared: false });
});

test('survives a platform with neither capability', async () => {
	stubNavigator({});
	expect(await shareInviteLink(URL_UNDER_TEST)).toEqual({ copied: false, shared: false });
});

test('uses a caller-supplied title', async () => {
	const share = vi.fn().mockResolvedValue(undefined);
	stubNavigator({ share, clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });

	await shareInviteLink(URL_UNDER_TEST, 'Link up with Ada');
	expect(share).toHaveBeenCalledWith({ title: 'Link up with Ada', url: URL_UNDER_TEST });
});

test('gives up on a clipboard write that never settles', async () => {
	// Chromium leaves writeText pending (rather than rejecting) when the
	// document is not focused. Callers navigate once this resolves, so a
	// permanently pending promise would leave the page stuck mid-submit.
	vi.useFakeTimers();
	try {
		stubNavigator({ clipboard: { writeText: vi.fn(() => new Promise(() => {})) } });

		const pending = shareInviteLink(URL_UNDER_TEST);
		await vi.advanceTimersByTimeAsync(2000);
		expect(await pending).toEqual({ copied: false, shared: false });
	} finally {
		vi.useRealTimers();
	}
});
