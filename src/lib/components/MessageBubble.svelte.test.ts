import { render } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import MessageBubble from './MessageBubble.svelte';
import type { MessageMetadataPayload, MessagePayload } from '$lib/crypto/messages';
import type { MessageView } from '$lib/types';

const observers: MockIntersectionObserver[] = [];

class MockIntersectionObserver {
	callback: IntersectionObserverCallback;
	elements = new Set<Element>();
	observe = vi.fn((element: Element) => {
		this.elements.add(element);
	});
	unobserve = vi.fn((element: Element) => {
		this.elements.delete(element);
	});
	disconnect = vi.fn(() => {
		this.elements.clear();
	});
	takeRecords = vi.fn(() => []);

	constructor(callback: IntersectionObserverCallback) {
		this.callback = callback;
		observers.push(this);
	}

	emit(element: Element, isIntersecting: boolean, intersectionRatio = 1) {
		this.callback(
			[
				{
					time: 0,
					target: element,
					isIntersecting,
					intersectionRatio,
					boundingClientRect: {
						top: 0,
						bottom: 120,
						left: 0,
						right: 120,
						width: 120,
						height: 120,
						x: 0,
						y: 0,
						toJSON: () => ({})
					},
					rootBounds: null,
					intersectionRect: {
						top: 0,
						bottom: isIntersecting ? 120 : 0,
						left: 0,
						right: isIntersecting ? 120 : 0,
						width: isIntersecting ? 120 : 0,
						height: isIntersecting ? 120 : 0,
						x: 0,
						y: 0,
						toJSON: () => ({})
					}
				} as IntersectionObserverEntry
			],
			this as unknown as IntersectionObserver
		);
	}
}

function installIntersectionObserverMock() {
	observers.length = 0;
	vi.stubGlobal(
		'IntersectionObserver',
		MockIntersectionObserver as unknown as typeof IntersectionObserver
	);
}

function emitIntersection(element: Element, isIntersecting: boolean, intersectionRatio = 1) {
	const observer = observers.find((candidate) => candidate.elements.has(element));
	if (!observer) throw new Error('expected observed element');
	observer.emit(element, isIntersecting, intersectionRatio);
}

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
		bodyFormat: 'lexical',
		metadataCiphertext: null,
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
	onRevealEmbed: vi.fn(),
	onRefreshEmbed: vi.fn(),
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
				props: { ...props, message: message(), payload, metadata: undefined }
			});
			expect(container.innerHTML).not.toContain('SUPERSECRETCIPHERTEXT');
			expect(container.innerHTML).not.toContain(CIPHERTEXT);
			unmount();
		}
	});

	it('shows a placeholder while decryption is in flight', () => {
		const { container } = render(MessageBubble, {
			props: { ...props, message: message(), payload: undefined, metadata: undefined }
		});
		expect(container.querySelector('.pending')).not.toBeNull();
		expect(container.querySelector('.text')).toBeNull();
	});

	// A real state, not an error: a thread can hold messages encrypted to a key
	// the user replaced after forgetting their password.
	it('explains an unreadable message rather than showing a blank bubble', () => {
		const { container, getByText } = render(MessageBubble, {
			props: { ...props, message: message(), payload: null, metadata: undefined }
		});
		expect(container.querySelector('.unreadable')).not.toBeNull();
		expect(getByText(/Ask your partner to restore your history/)).toBeTruthy();
	});

	it('renders the decrypted text once it arrives', () => {
		const { getByText } = render(MessageBubble, {
			props: {
				...props,
				message: message(),
				payload: { version: 1, text: 'meet me later', attachments: [] },
				metadata: undefined
			}
		});
		expect(getByText('meet me later')).toBeTruthy();
	});

	it('passes cached embed metadata through to the inline embed renderer in auto-load mode', async () => {
		installIntersectionObserverMock();
		const fetchMock = vi.fn(() => new Promise(() => {}));
		vi.stubGlobal('fetch', fetchMock);
		const metadata: MessageMetadataPayload = {
			version: 1,
			embeds: [
				{
					href: 'https://vimeo.com/2',
					fetchedAt: Date.now(),
					kind: 'card',
					providerName: 'Vimeo',
					title: 'Cached title',
					description: null,
					thumbnailUrl: 'https://example.com/thumb.jpg',
					canonicalUrl: 'https://vimeo.com/2',
					imageUrl: null,
					iframeSrc: null,
					iframeHeight: null,
					faviconUrl: null,
					themeColor: null
				}
			]
		};

		const { container, findByText } = render(MessageBubble, {
			props: {
				...props,
				message: message(),
				payload: { version: 1, text: 'https://vimeo.com/2', attachments: [] },
				metadata,
				autoLoadEmbeds: true
			}
		});

		expect(container.querySelector('.skeleton-shell')).not.toBeNull();
		await vi.waitFor(() => {
			expect(observers.length).toBeGreaterThan(0);
		});
		emitIntersection(container.querySelector('.skeleton-shell')!, true, 1);
		await findByText('Cached title');
		await vi.waitFor(() => {
			expect(container.querySelector('.card')).not.toBeNull();
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('keeps cached message embeds behind Show in manual mode', () => {
		const metadata: MessageMetadataPayload = {
			version: 1,
			embeds: [
				{
					href: 'https://vimeo.com/2',
					fetchedAt: Date.now(),
					kind: 'card',
					providerName: 'Vimeo',
					title: 'Cached title',
					description: null,
					thumbnailUrl: 'https://example.com/thumb.jpg',
					canonicalUrl: 'https://vimeo.com/2',
					imageUrl: null,
					iframeSrc: null,
					iframeHeight: null,
					faviconUrl: null,
					themeColor: null
				}
			]
		};

		const { container, getByRole, queryByText } = render(MessageBubble, {
			props: {
				...props,
				message: message(),
				payload: { version: 1, text: 'https://vimeo.com/2', attachments: [] },
				metadata
			}
		});

		expect(getByRole('button', { name: 'Show' })).toBeTruthy();
		expect(queryByText('Cached title')).toBeNull();
		expect(container.querySelector('.card')).toBeNull();
	});

	it('shows a reveal button for supported embeds when no cache exists yet', () => {
		const { getByRole } = render(MessageBubble, {
			props: {
				...props,
				message: message(),
				payload: { version: 1, text: 'https://vimeo.com/2', attachments: [] },
				metadata: null
			}
		});

		expect(getByRole('button', { name: 'Show' })).toBeTruthy();
	});

	it('waits for encrypted message metadata before starting a live embed fetch', () => {
		const fetchMock = vi.fn(() => new Promise(() => {}));
		vi.stubGlobal('fetch', fetchMock);

		const { container } = render(MessageBubble, {
			props: {
				...props,
				message: message({ metadataCiphertext: 'encrypted-metadata' }),
				payload: { version: 1, text: 'https://vimeo.com/2', attachments: [] },
				metadata: undefined
			}
		});

		expect(fetchMock).not.toHaveBeenCalled();
		expect(container.querySelector('a')?.getAttribute('href')).toBe('https://vimeo.com/2');
	});

	it('marks which side the message is on', () => {
		const theirs = render(MessageBubble, {
			props: { ...props, message: message({ mine: false }), payload: null, metadata: undefined }
		});
		expect(theirs.container.querySelector('li.theirs')).not.toBeNull();
		theirs.unmount();

		const mine = render(MessageBubble, {
			props: { ...props, message: message({ mine: true }), payload: null, metadata: undefined }
		});
		expect(mine.container.querySelector('li.mine')).not.toBeNull();
	});

	/**
	 * The requirement is reacting to messages you have *received*. The server
	 * refuses either way, but offering a control that cannot work is its own bug.
	 */
	it('offers no reaction control on your own message', () => {
		const { container } = render(MessageBubble, {
			props: { ...props, message: message({ mine: true }), payload: null, metadata: undefined }
		});
		expect(container.querySelector('.trigger')).toBeNull();
	});

	it('offers one on a message you received', () => {
		const { container } = render(MessageBubble, {
			props: { ...props, message: message({ mine: false }), payload: null, metadata: undefined }
		});
		expect(container.querySelector('.trigger')).not.toBeNull();
	});

	it('renders already-decrypted reactions and nothing when there are none', () => {
		const withReaction = render(MessageBubble, {
			props: {
				...props,
				message: message(),
				payload: null,
				metadata: undefined,
				reactions: [{ emoji: '🔥', mine: true }]
			}
		});
		expect(withReaction.container.querySelector('.reactions')?.textContent).toContain('🔥');
		withReaction.unmount();

		const without = render(MessageBubble, {
			props: { ...props, message: message(), payload: null, metadata: undefined }
		});
		expect(without.container.querySelector('.reactions')).toBeNull();
	});
});
