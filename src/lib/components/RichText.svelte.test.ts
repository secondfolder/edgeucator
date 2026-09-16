import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import RichText from './RichText.svelte';

/**
 * jsdom never upgrades `wa-*` elements, so these assert on what the component
 * emits rather than on rendered behaviour — per AGENTS.md. RichText renders
 * only native elements, so these assertions are close to real behaviour; the
 * one thing jsdom cannot exercise is the third-party fetch in UrlEmbed, which
 * is covered here with providers that need no fetch and in the e2e suite with
 * stubbed routes.
 */

function links(container: HTMLElement): HTMLAnchorElement[] {
	return [...container.querySelectorAll('a')];
}

describe('RichText', () => {
	it('renders plain text with no links unchanged', () => {
		const { container } = render(RichText, { props: { text: 'just words, no urls' } });
		expect(container.textContent).toBe('just words, no urls');
		expect(links(container)).toHaveLength(0);
	});

	it('turns a bare URL into an anchor with safe link attributes', () => {
		const { container } = render(RichText, {
			props: { text: 'look at https://example.com/page now' }
		});
		const [link] = links(container);
		expect(link?.getAttribute('href')).toBe('https://example.com/page');
		expect(link?.getAttribute('target')).toBe('_blank');
		expect(link?.getAttribute('rel')).toContain('noopener');
		expect(link?.getAttribute('rel')).toContain('ugc');
		expect(container.textContent).toContain('look at');
		expect(container.textContent).toContain('now');
	});

	it('renders a javascript: scheme as text, never as a link', () => {
		const { container } = render(RichText, {
			props: { text: 'click javascript:alert(1) here' }
		});
		expect(links(container)).toHaveLength(0);
		expect(container.textContent).toContain('javascript:alert(1)');
	});

	it('renders what looks like markup as inert text', () => {
		const { container } = render(RichText, {
			props: { text: '<script>alert(1)</script> and <img src=x onerror=1>' }
		});
		expect(container.querySelector('script')).toBeNull();
		expect(container.querySelector('img')).toBeNull();
		expect(container.textContent).toContain('<script>alert(1)</script>');
	});

	it('embeds every supported URL, not just the first', () => {
		const { container } = render(RichText, {
			props: {
				text: 'https://www.redgifs.com/watch/abc123 and https://www.redgifs.com/watch/def456'
			}
		});
		const srcs = [...container.querySelectorAll('iframe')].map((iframe) =>
			iframe.getAttribute('src')
		);
		expect(srcs).toEqual([
			'https://www.redgifs.com/ifr/abc123',
			'https://www.redgifs.com/ifr/def456'
		]);
	});

	it('maxEmbeds=0 leaves every URL as a plain link', () => {
		const { container } = render(RichText, {
			props: { text: 'https://www.redgifs.com/watch/abc123', maxEmbeds: 0 }
		});
		expect(container.querySelectorAll('iframe')).toHaveLength(0);
		expect(links(container)).toHaveLength(1);
	});

	it('embeds a direct image', () => {
		const { container } = render(RichText, { props: { text: 'https://i.imgur.com/cat.jpg' } });
		const img = container.querySelector('img');
		expect(img?.getAttribute('src')).toBe('https://i.imgur.com/cat.jpg');
	});

	it('preserves surrounding whitespace as text tokens', () => {
		const { container } = render(RichText, {
			props: { text: 'before https://example.com/a\nafter' }
		});
		expect(container.textContent).toBe('before https://example.com/a\nafter');
	});
});
