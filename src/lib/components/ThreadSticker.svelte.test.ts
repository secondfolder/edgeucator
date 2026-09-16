import { render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageMetadataPayload, MessagePayload } from '$lib/crypto/messages';
import type { ThreadStickerView } from '$lib/types';

vi.mock('$app/paths', () => ({
	resolve: (id: string, params?: Record<string, string>) =>
		params ? id.replace(/\[(\w+)\]/g, (_, key) => params[key]) : id
}));

vi.mock('$lib/sticker', () => ({
	stickerStyle: () => '--jx: 0%; --jy: 0%; --tilt: 0deg;'
}));

vi.mock('$lib/crypto/session.svelte', () => ({
	currentKeyring: () => ({ status: 'unlocked', identity: 'secret' })
}));

const openMessage =
	vi.fn<(ciphertext: string, identity: CryptoKey | string) => Promise<MessagePayload | null>>();

const openMessageMetadata =
	vi.fn<
		(ciphertext: string, identity: CryptoKey | string) => Promise<MessageMetadataPayload | null>
	>();

const fetchAttachment =
	vi.fn<
		(
			partnershipId: string,
			info: MessagePayload['attachments'][number]
		) => Promise<{ url: string; blob: Blob }>
	>();

vi.mock('$lib/messaging/client', () => ({
	openMessage,
	openMessageMetadata,
	fetchAttachment
}));

const { default: ThreadSticker } = await import('./ThreadSticker.svelte');

function thread(overrides: Partial<ThreadStickerView> = {}): ThreadStickerView {
	return {
		id: 't1',
		icon: 'fire',
		unread: false,
		lastMessageAt: new Date('2026-09-13T14:15:00Z'),
		lastFullyReadAt: new Date('2026-09-12T18:00:00Z'),
		messageCount: 2,
		previewCiphertext: 'ciphertext',
		previewMetadataCiphertext: null,
		...overrides
	};
}

const realDateTimeFormat = Intl.DateTimeFormat;

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-09-13T15:00:00Z'));
	openMessage.mockReset();
	openMessageMetadata.mockReset();
	fetchAttachment.mockReset();
	Intl.DateTimeFormat = class {
		constructor(
			_: string | string[] | undefined,
			private readonly options?: Intl.DateTimeFormatOptions
		) {}

		format() {
			return this.options?.hour ? 'TIME' : 'DATE';
		}
	} as unknown as typeof Intl.DateTimeFormat;
});

afterEach(() => {
	vi.useRealTimers();
	Intl.DateTimeFormat = realDateTimeFormat;
	vi.clearAllMocks();
});

describe('ThreadSticker', () => {
	it('shows a sealed envelope only for a never-opened unread thread', () => {
		openMessage.mockResolvedValue({ version: 1, text: 'secret', attachments: [] });
		const { container, queryByText } = render(ThreadSticker, {
			props: {
				thread: thread({ unread: true, lastFullyReadAt: null }),
				partnershipId: 'p1',
				position: 1,
				total: 1
			}
		});

		expect(container.querySelector('wa-icon')?.getAttribute('name')).toBe('envelope');
		expect(queryByText('secret')).toBeNull();
		expect(openMessage).not.toHaveBeenCalled();
	});

	it('shows a decrypted preview for a reopened unread thread instead of the envelope', async () => {
		openMessage.mockResolvedValue({ version: 1, text: 'first whisper', attachments: [] });
		const { container, findByText } = render(ThreadSticker, {
			props: {
				thread: thread({ unread: true, lastFullyReadAt: new Date('2026-09-12T18:00:00Z') }),
				partnershipId: 'p1',
				position: 1,
				total: 1
			}
		});

		await findByText('first whisper');
		expect(container.querySelector('wa-icon')).toBeNull();
	});

	it('shows a single text bubble full-size when the first message has only text', async () => {
		openMessage.mockResolvedValue({ version: 1, text: 'soft words', attachments: [] });

		const { container, findByText } = render(ThreadSticker, {
			props: {
				thread: thread(),
				partnershipId: 'p1',
				position: 1,
				total: 1
			}
		});

		await findByText('soft words');
		expect(container.querySelector('.fan')).toBeNull();
		expect(container.querySelector('.preview-single')).not.toBeNull();
		expect(container.querySelector('.single-card.text-bubble')).not.toBeNull();
	});

	it('prefers cached embed metadata for the board preview when present', async () => {
		openMessage.mockResolvedValue({ version: 1, text: 'https://example.com', attachments: [] });
		openMessageMetadata.mockResolvedValue({
			version: 1,
			embeds: [
				{
					href: 'https://example.com',
					fetchedAt: Date.now(),
					kind: 'card',
					providerName: 'Example',
					title: 'A richer preview',
					description: null,
					thumbnailUrl: 'https://example.com/thumb.jpg',
					canonicalUrl: 'https://example.com',
					imageUrl: null,
					iframeSrc: null,
					iframeHeight: null,
					faviconUrl: null,
					themeColor: null
				}
			]
		});

		const { container, findByText } = render(ThreadSticker, {
			props: {
				thread: thread({ previewMetadataCiphertext: 'metadata' }),
				partnershipId: 'p1',
				position: 1,
				total: 1
			}
		});

		await findByText('A richer preview');
		expect(container.querySelector('.embed-preview')).not.toBeNull();
		expect(container.querySelector('.embed-thumb')).toHaveAttribute(
			'src',
			'https://example.com/thumb.jpg'
		);
	});

	it('shows a send time for today and an opened date when the latest message was read later', async () => {
		openMessage.mockResolvedValue({ version: 1, text: 'meet me later', attachments: [] });
		const { container, findByText } = render(ThreadSticker, {
			props: {
				thread: thread(),
				partnershipId: 'p1',
				position: 1,
				total: 1
			}
		});

		await findByText('meet me later');
		expect(container.querySelector('.meta')?.textContent).toContain('TIME');
		expect(container.querySelector('.meta')?.textContent).toContain('opened DATE');
	});

	it('shows a thumbnail when the first message is attachment-only', async () => {
		openMessage.mockResolvedValue({
			version: 1,
			text: '',
			attachments: [
				{
					id: 'a1',
					key: 'AGE-SECRET-KEY-1TEST',
					kind: 'image',
					mimeType: 'image/png',
					fileName: 'photo.png'
				}
			]
		});
		fetchAttachment.mockResolvedValue({ url: 'blob:thumb', blob: new Blob() });

		const { container } = render(ThreadSticker, {
			props: {
				thread: thread(),
				partnershipId: 'p1',
				position: 1,
				total: 1
			}
		});

		await waitFor(() => {
			const image = container.querySelector('img.thumb');
			expect(image).not.toBeNull();
			expect(image).toHaveAttribute('src', 'blob:thumb');
		});
		expect(container.querySelector('.preview-media')).not.toBeNull();
		expect(container.querySelector('.fan')).toBeNull();
	});

	it('fans multiple image thumbnails out with the text in its own bubble', async () => {
		openMessage.mockResolvedValue({
			version: 1,
			text: 'soft words',
			attachments: [
				{
					id: 'a1',
					key: 'AGE-SECRET-KEY-1TEST',
					kind: 'image',
					mimeType: 'image/png',
					fileName: 'one.png'
				},
				{
					id: 'a2',
					key: 'AGE-SECRET-KEY-1TEST2',
					kind: 'image',
					mimeType: 'image/png',
					fileName: 'two.png'
				}
			]
		});
		fetchAttachment
			.mockResolvedValueOnce({ url: 'blob:one', blob: new Blob() })
			.mockResolvedValueOnce({ url: 'blob:two', blob: new Blob() });

		const { container, findByText } = render(ThreadSticker, {
			props: {
				thread: thread(),
				partnershipId: 'p1',
				position: 1,
				total: 1
			}
		});

		await findByText('soft words');
		await waitFor(() => {
			expect(container.querySelectorAll('.media-card img.thumb')).toHaveLength(2);
		});
		expect(container.querySelector('.fan')).not.toBeNull();
		expect(container.querySelector('.text-bubble')).not.toBeNull();
	});
});
