import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import RichText from './RichText.svelte';
import type { RichTextDocument } from '$lib/richtext';

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

function stored(children: RichTextDocument['root']['children']): string {
	return JSON.stringify({ root: { type: 'root', children } });
}

function text(value: string, format = 0) {
	return { type: 'text' as const, text: value, format };
}

describe('RichText, stored documents', () => {
	it('renders a paragraph of plain text', () => {
		const { container } = render(RichText, {
			props: { text: stored([{ type: 'paragraph', children: [text('just words')] }]) }
		});
		expect(container.textContent).toBe('just words');
		expect(container.querySelector('p')).not.toBeNull();
	});

	it('renders format bits as real elements', () => {
		const { container } = render(RichText, {
			props: {
				text: stored([
					{
						type: 'paragraph',
						children: [text('bold', 1), text('italic', 2), text('struck', 4), text('code', 16)]
					}
				])
			}
		});
		expect(container.querySelector('strong')?.textContent).toBe('bold');
		expect(container.querySelector('em')?.textContent).toBe('italic');
		expect(container.querySelector('s')?.textContent).toBe('struck');
		expect(container.querySelector('code')?.textContent).toBe('code');
	});

	it('nests combined formats in a stable order', () => {
		const { container } = render(RichText, {
			props: { text: stored([{ type: 'paragraph', children: [text('both', 1 | 2)] }]) }
		});
		expect(container.querySelector('strong > em')?.textContent).toBe('both');
	});

	it('ignores the underline bit, which the format cannot round-trip', () => {
		const { container } = render(RichText, {
			props: { text: stored([{ type: 'paragraph', children: [text('plain', 8)] }]) }
		});
		expect(container.querySelector('u')).toBeNull();
		expect(container.textContent).toBe('plain');
	});

	it('does not insert whitespace between adjacent inline nodes', () => {
		const { container } = render(RichText, {
			props: {
				text: stored([
					{ type: 'paragraph', children: [text('one'), text('two', 1), text('three')] }
				])
			}
		});
		expect(container.textContent).toBe('onetwothree');
	});

	it('renders a line break as a br, not as a new paragraph', () => {
		const { container } = render(RichText, {
			props: {
				text: stored([
					{ type: 'paragraph', children: [text('one'), { type: 'linebreak' }, text('two')] }
				])
			}
		});
		expect(container.querySelectorAll('p')).toHaveLength(1);
		expect(container.querySelectorAll('br')).toHaveLength(1);
	});

	it('renders lists, keeping an ordered list start', () => {
		const { container } = render(RichText, {
			props: {
				text: stored([
					{
						type: 'list',
						listType: 'number',
						start: 3,
						children: [{ type: 'listitem', value: 3, children: [text('three')] }]
					}
				])
			}
		});
		expect(container.querySelector('ol')?.getAttribute('start')).toBe('3');
		expect(container.querySelector('li')?.textContent).toBe('three');
	});

	it('renders a link with safe attributes', () => {
		const { container } = render(RichText, {
			props: {
				text: stored([
					{
						type: 'paragraph',
						children: [
							{ type: 'link', url: 'https://example.com/page', children: [text('the page')] }
						]
					}
				])
			}
		});
		const [link] = links(container);
		expect(link?.getAttribute('href')).toBe('https://example.com/page');
		expect(link?.getAttribute('target')).toBe('_blank');
		expect(link?.getAttribute('rel')).toContain('noopener');
		expect(link?.getAttribute('rel')).toContain('ugc');
		expect(link?.textContent).toBe('the page');
	});

	/** Lexical's own flag for "I removed this link". Re-linking it would be a bug. */
	it('renders an unlinked autolink as plain text', () => {
		const { container } = render(RichText, {
			props: {
				text: stored([
					{
						type: 'paragraph',
						children: [
							{
								type: 'autolink',
								url: 'https://example.com/x',
								isUnlinked: true,
								children: [text('https://example.com/x')]
							}
						]
					}
				])
			}
		});
		expect(links(container)).toHaveLength(0);
		expect(container.textContent).toBe('https://example.com/x');
	});

	it('renders an embed node as an embed', () => {
		const { container } = render(RichText, {
			props: { text: stored([{ type: 'embed', url: 'https://i.imgur.com/cat.jpg' }]) }
		});
		expect(container.querySelector('img')?.getAttribute('src')).toBe('https://i.imgur.com/cat.jpg');
	});

	it('degrades an embed whose provider is gone to a plain link', () => {
		const { container } = render(RichText, {
			props: { text: stored([{ type: 'embed', url: 'https://example.com/nothing' }]) }
		});
		expect(links(container)[0]?.getAttribute('href')).toBe('https://example.com/nothing');
	});
});

describe('RichText, security', () => {
	it('renders a javascript: scheme as text, never as a link', () => {
		const { container } = render(RichText, {
			props: {
				text: stored([
					{
						type: 'paragraph',
						children: [{ type: 'link', url: 'javascript:alert(1)', children: [text('click me')] }]
					}
				])
			}
		});
		expect(links(container)).toHaveLength(0);
		expect(container.textContent).toBe('click me');
	});

	it('renders what looks like markup as inert text', () => {
		const { container } = render(RichText, {
			props: { text: '<script>alert(1)</script> and <img src=x onerror=1>' }
		});
		expect(container.querySelector('script')).toBeNull();
		expect(container.querySelector('img')).toBeNull();
		expect(container.textContent).toContain('<script>alert(1)</script>');
	});
});

/* ── LEGACY-RICHTEXT — delete with the legacy reader ─────────────────────── */

describe('RichText, legacy plain text', () => {
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
		expect(link?.getAttribute('rel')).toContain('ugc');
		expect(container.textContent).toBe('look at https://example.com/page now');
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

	it('embeds a direct image', () => {
		const { container } = render(RichText, { props: { text: 'https://i.imgur.com/cat.jpg' } });
		expect(container.querySelector('img')?.getAttribute('src')).toBe('https://i.imgur.com/cat.jpg');
	});

	it('preserves the text around a link', () => {
		const { container } = render(RichText, {
			props: { text: 'before https://example.com/a\nafter' }
		});
		expect(container.textContent).toBe('before https://example.com/aafter');
		expect(container.querySelectorAll('br')).toHaveLength(1);
	});
});
