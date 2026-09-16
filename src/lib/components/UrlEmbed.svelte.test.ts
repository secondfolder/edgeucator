import { fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import UrlEmbed from './UrlEmbed.svelte';
import { clearOembedCache, type EmbedSpec } from '$lib/embeds';

afterEach(() => {
	clearOembedCache();
	vi.unstubAllGlobals();
});

describe('UrlEmbed', () => {
	it('renders the redgifs player iframe with the sandbox set', () => {
		const { container } = render(UrlEmbed, {
			props: {
				spec: {
					kind: 'iframe',
					src: 'https://www.redgifs.com/ifr/abc123',
					title: 'Redgifs video'
				},
				href: 'https://www.redgifs.com/watch/abc123',
				label: 'https://www.redgifs.com/watch/abc123'
			}
		});
		const iframe = container.querySelector('iframe');
		expect(iframe?.getAttribute('src')).toBe('https://www.redgifs.com/ifr/abc123');
		expect(iframe?.getAttribute('title')).toBe('Redgifs video');
		// allow-top-navigation must NOT be grantable by message content.
		expect(iframe?.getAttribute('sandbox')).not.toContain('allow-top-navigation');
		expect(iframe?.getAttribute('sandbox')).toContain('allow-scripts');
		expect(container.textContent).toContain('Loading embed');
	});

	it('keeps the loading overlay over an iframe until it loads', async () => {
		const { container } = render(UrlEmbed, {
			props: {
				spec: {
					kind: 'iframe',
					src: 'https://www.redgifs.com/ifr/abc123',
					title: 'Redgifs video'
				},
				href: 'https://www.redgifs.com/watch/abc123',
				label: 'https://www.redgifs.com/watch/abc123'
			}
		});
		const frame = container.querySelector('iframe');
		expect(container.querySelector('.loading-overlay')).not.toBeNull();
		if (!frame) throw new Error('expected iframe');
		await fireEvent.load(frame);
		expect(container.querySelector('.loading-overlay')).toBeNull();
	});

	it('renders a direct image with alt text from the label', () => {
		const { container } = render(UrlEmbed, {
			props: {
				spec: { kind: 'image', url: 'https://i.imgur.com/cat.jpg' },
				href: 'https://i.imgur.com/cat.jpg',
				label: 'https://i.imgur.com/cat.jpg'
			}
		});
		expect(container.querySelector('img')?.getAttribute('alt')).toBe('https://i.imgur.com/cat.jpg');
	});

	it('renders a sandboxed iframe when oEmbed html exposes one directly', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				Response.json({
					title: 'A post',
					provider_name: 'Reddit',
					html: '<iframe src="https://embed.example.com/x"></iframe><script>alert(1)</script><img src=x onerror=alert(2)>'
				})
			)
		);
		const { container } = render(UrlEmbed, {
			props: {
				spec: { kind: 'oembed', endpoint: 'https://oembed.test/1' },
				href: 'https://www.reddit.com/r/x/comments/1/a/',
				label: 'reddit link'
			}
		});
		// The fetch resolves in an $effect; wait for it to land.
		await vi.waitFor(() => {
			expect(container.querySelector('.player iframe')).not.toBeNull();
		});
		const frame = container.querySelector('.player iframe');
		expect(frame?.getAttribute('src')).toBe('https://embed.example.com/x');
		expect(frame?.getAttribute('sandbox')).toContain('allow-scripts');
	});

	it('falls back to a plain link when the oEmbed fetch fails', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('nope', { status: 500 }))
		);
		const { container } = render(UrlEmbed, {
			props: {
				spec: { kind: 'oembed', endpoint: 'https://oembed.test/2' },
				href: 'https://vimeo.com/1',
				label: 'vimeo link'
			}
		});
		await vi.waitFor(() => {
			expect(container.querySelector('a')?.getAttribute('href')).toBe('https://vimeo.com/1');
		});
		expect(container.querySelector('.player iframe')).toBeNull();
	});

	it('falls back to the metadata card when oEmbed html has no direct iframe', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				Response.json({
					title: 'A card-only post',
					provider_name: 'Provider',
					html: '<blockquote>needs a script loader</blockquote>'
				})
			)
		);
		const { container } = render(UrlEmbed, {
			props: {
				spec: { kind: 'oembed', endpoint: 'https://oembed.test/4' },
				href: 'https://provider.example/post',
				label: 'provider link'
			}
		});
		await vi.waitFor(() => {
			expect(container.querySelector('.card')).not.toBeNull();
		});
		expect(container.querySelector('.player iframe')).toBeNull();
	});

	it('renders a plain link before the oEmbed resolves', () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() => new Promise(() => {}))
		);
		const { container } = render(UrlEmbed, {
			props: {
				spec: { kind: 'oembed', endpoint: 'https://oembed.test/3' },
				href: 'https://vimeo.com/2',
				label: 'vimeo link'
			}
		});
		expect(container.querySelector('a')?.textContent).toBe('vimeo link');
	});

	describe('server-proxied reddit embeds', () => {
		const redditProps = {
			spec: { kind: 'server-oembed', url: 'https://www.reddit.com/r/x/comments/1/a/' },
			href: 'https://www.reddit.com/r/x/comments/1/a/',
			label: 'reddit link'
		} satisfies {
			spec: Extract<EmbedSpec, { kind: 'server-oembed' }>;
			href: string;
			label: string;
		};

		it('does not fetch anything until the viewer clicks', () => {
			const fetchMock = vi.fn(() => new Promise(() => {}));
			vi.stubGlobal('fetch', fetchMock);
			const { container, queryByText } = render(UrlEmbed, { props: redditProps });
			// The link is present, the gate button is offered, and crucially no
			// request has gone out — the URL has not left the browser yet.
			expect(container.querySelector('a')?.getAttribute('href')).toBe(redditProps.href);
			expect(queryByText('Show')).not.toBeNull();
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('keeps the reddit button mounted in a busy state until the proxy resolves', async () => {
			const resolver: { current: ((response: Response) => void) | null } = { current: null };
			vi.stubGlobal(
				'fetch',
				vi.fn(
					() =>
						new Promise<Response>((resolve) => {
							resolver.current = resolve;
						})
				)
			);
			const { container, getByRole, queryByText } = render(UrlEmbed, { props: redditProps });

			await fireEvent.click(getByRole('button', { name: 'Show' }));
			const button = getByRole('button', { name: 'Show' });
			expect(button.getAttribute('aria-busy')).toBe('true');
			expect(button.hasAttribute('disabled')).toBe(true);
			expect(container.querySelector('.button-loading')).not.toBeNull();
			expect(container.querySelector('.card')).toBeNull();

			if (!resolver.current) throw new Error('expected pending fetch resolver');
			resolver.current(
				Response.json({
					title: 'A post',
					provider_name: 'Reddit',
					permalink: 'https://www.reddit.com/r/x/comments/1/a/',
					outbound: null,
					html: '<blockquote><a href="https://www.reddit.com/x">A post</a></blockquote>',
					height: 600
				})
			);

			await vi.waitFor(() => {
				expect(container.querySelector('.card')).not.toBeNull();
			});
			expect(queryByText('Loading…')).toBeNull();
		});

		it('renders the outbound link natively when the proxy reports one', async () => {
			vi.stubGlobal(
				'fetch',
				vi.fn(async () =>
					Response.json({
						title: 'A post',
						provider_name: 'Reddit',
						permalink: 'https://www.reddit.com/r/x/comments/1/a/',
						outbound: 'https://www.redgifs.com/watch/abc123'
					})
				)
			);
			const { container } = render(UrlEmbed, { props: redditProps });
			container.querySelector('button')?.click();
			await vi.waitFor(() => {
				expect(container.querySelector('.player iframe')).not.toBeNull();
			});
			const card = container.querySelector('.card');
			expect(card?.textContent).toContain('Reddit');
			expect(card?.textContent).toContain('A post');
			expect(container.querySelector('.loading-overlay')).not.toBeNull();
			// The post's own redgifs link renders as our native player — not
			// reddit's frame, whose NSFW previews come back dead.
			const player = container.querySelector('.player iframe');
			expect(player?.getAttribute('src')).toBe('https://www.redgifs.com/ifr/abc123');
			expect(player?.closest('a')).toBeNull();
			expect(container.querySelector('iframe.reddit-frame')).toBeNull();
		});

		it('fetches through the same-origin proxy only after the click', async () => {
			const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(async () =>
				Response.json({
					title: 'A post',
					provider_name: 'Reddit',
					html: '<blockquote><a href="https://www.reddit.com/x">A post</a></blockquote>',
					height: 600,
					permalink: 'https://www.reddit.com/r/x/comments/1/a/',
					outbound: null
				})
			);
			vi.stubGlobal('fetch', fetchMock);
			const { container } = render(UrlEmbed, { props: redditProps });
			expect(fetchMock).not.toHaveBeenCalled();

			container.querySelector('button')?.click();
			await vi.waitFor(() => {
				expect(fetchMock).toHaveBeenCalledTimes(1);
			});
			const firstCall = fetchMock.mock.calls.at(0);
			expect(firstCall?.[0]).toBe(`/api/oembed?url=${encodeURIComponent(redditProps.spec.url)}`);

			// The permalink is framed directly at embed.reddit.com — same-origin
			// is the frame's own origin, not ours — and the sanitized {@html}
			// path is not used when a permalink frame exists.
			const frame = container.querySelector('iframe.reddit-frame');
			expect(frame?.getAttribute('src')).toBe(
				'https://embed.reddit.com/r/x/comments/1/a/?embed=true&ref_source=embed' +
					'&embed_host_url=' +
					encodeURIComponent('http://localhost:3000')
			);
			expect(frame?.getAttribute('height')).toBe('600');
			expect(container.querySelector('.player iframe')).toBeNull();
		});
	});
});
