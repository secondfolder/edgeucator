import { render } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import MessageBubble from './MessageBubble.svelte';
import type { MessagePayload } from '$lib/crypto/messages';
import type { MessageView } from '$lib/types';

/**
 * jsdom never upgrades `wa-*` elements, so these assert on what the component
 * emits rather than on rendered behaviour — per AGENTS.md. Everything that
 * needs Web Awesome to actually work is in the Playwright suite.
 */

const CIPHERTEXT = 'YWdlLWVuY3J5cHRpb24ub3JnL3YxCg==SUPERSECRETCIPHERTEXT';

function message(over: Partial<MessageView> = {}): MessageView {
	return {
		id: 'm1',
		mine: false,
		ciphertext: CIPHERTEXT,
		createdAt: new Date('2026-01-01T12:00:00Z'),
		attachments: [],
		reactions: [],
		...over
	};
}

const props = {
	partnershipId: 'p1',
	when: '12:00',
	reactions: [],
	onReact: vi.fn(),
	onClearReaction: vi.fn()
};

describe('MessageBubble', () => {
	/**
	 * THE assertion for this component. Rendering the ciphertext — even for a
	 * frame, even as a placeholder — would be the worst bug it could have, and
	 * it is the kind of thing a refactor introduces by reaching for the wrong
	 * field name.
	 */
	it('never renders the ciphertext, in any state', () => {
		for (const payload of [
			undefined,
			null,
			{ version: 1, text: 'the plaintext', attachments: [] } as MessagePayload
		]) {
			const { container, unmount } = render(MessageBubble, {
				props: { ...props, message: message(), payload }
			});
			expect(container.innerHTML).not.toContain('SUPERSECRETCIPHERTEXT');
			expect(container.innerHTML).not.toContain(CIPHERTEXT);
			unmount();
		}
	});

	it('shows a placeholder while decryption is in flight', () => {
		const { container } = render(MessageBubble, {
			props: { ...props, message: message(), payload: undefined }
		});
		expect(container.querySelector('.pending')).not.toBeNull();
		expect(container.querySelector('.text')).toBeNull();
	});

	// A real state, not an error: a thread can hold messages encrypted to a key
	// the user replaced after forgetting their password.
	it('explains an unreadable message rather than showing a blank bubble', () => {
		const { container, getByText } = render(MessageBubble, {
			props: { ...props, message: message(), payload: null }
		});
		expect(container.querySelector('.unreadable')).not.toBeNull();
		expect(getByText(/Ask your partner to restore your history/)).toBeTruthy();
	});

	it('renders the decrypted text once it arrives', () => {
		const { getByText } = render(MessageBubble, {
			props: {
				...props,
				message: message(),
				payload: { version: 1, text: 'meet me later', attachments: [] }
			}
		});
		expect(getByText('meet me later')).toBeTruthy();
	});

	it('marks which side the message is on', () => {
		const theirs = render(MessageBubble, {
			props: { ...props, message: message({ mine: false }), payload: null }
		});
		expect(theirs.container.querySelector('li.theirs')).not.toBeNull();
		theirs.unmount();

		const mine = render(MessageBubble, {
			props: { ...props, message: message({ mine: true }), payload: null }
		});
		expect(mine.container.querySelector('li.mine')).not.toBeNull();
	});

	/**
	 * The requirement is reacting to messages you have *received*. The server
	 * refuses either way, but offering a control that cannot work is its own bug.
	 */
	it('offers no reaction control on your own message', () => {
		const { container } = render(MessageBubble, {
			props: { ...props, message: message({ mine: true }), payload: null }
		});
		expect(container.querySelector('.trigger')).toBeNull();
	});

	it('offers one on a message you received', () => {
		const { container } = render(MessageBubble, {
			props: { ...props, message: message({ mine: false }), payload: null }
		});
		expect(container.querySelector('.trigger')).not.toBeNull();
	});

	it('renders already-decrypted reactions and nothing when there are none', () => {
		const withReaction = render(MessageBubble, {
			props: {
				...props,
				message: message(),
				payload: null,
				reactions: [{ emoji: '🔥', mine: true }]
			}
		});
		expect(withReaction.container.querySelector('.reactions')?.textContent).toContain('🔥');
		withReaction.unmount();

		const without = render(MessageBubble, {
			props: { ...props, message: message(), payload: null }
		});
		expect(without.container.querySelector('.reactions')).toBeNull();
	});
});
