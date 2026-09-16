import { afterEach, describe, expect, it, vi } from 'vitest';
import { embedSpecFor, fetchOembed, isSafeHttpUrl, clearOembedCache, cachedOembed } from './embeds';

describe('isSafeHttpUrl', () => {
	it.each([
		'https://example.com/a',
		'http://example.com',
		['HTTPS://EXAMPLE.COM/A', 'case-insensitive scheme']
	])('accepts %s', (href) => {
		expect(isSafeHttpUrl(href as string)).toBe(true);
	});

	it.each([
		'javascript:alert(1)',
		'data:text/html,<script>',
		'vbscript:x',
		'//example.com',
		'ftp://example.com',
		'not a url'
	])('rejects %s', (href) => {
		expect(isSafeHttpUrl(href)).toBe(false);
	});
});

describe('embedSpecFor', () => {
	it('builds the redgifs player iframe from a watch URL', () => {
		expect(embedSpecFor('https://www.redgifs.com/watch/abc123-definitely')).toEqual({
			kind: 'iframe',
			src: 'https://www.redgifs.com/ifr/abc123-definitely',
			title: 'Redgifs video'
		});
	});

	it('accepts the bare redgifs domain', () => {
		expect(embedSpecFor('https://redgifs.com/watch/someid')).toMatchObject({
			kind: 'iframe',
			src: 'https://www.redgifs.com/ifr/someid'
		});
	});

	it('leaves other redgifs paths as plain links', () => {
		expect(embedSpecFor('https://www.redgifs.com/browse')).toBeNull();
	});

	it('extracts the id from every youtube URL shape', () => {
		const expectEmbed = (href: string, id: string) =>
			expect(embedSpecFor(href)).toMatchObject({
				kind: 'iframe',
				src: `https://www.youtube-nocookie.com/embed/${id}`
			});

		expectEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ');
		expectEmbed('https://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ');
		expectEmbed('https://www.youtube.com/shorts/abcDEF123-4', 'abcDEF123-4');
	});

	it('rejects malformed youtube ids', () => {
		expect(embedSpecFor('https://youtu.be/')).toBeNull();
		expect(embedSpecFor('https://youtu.be/' + 'x'.repeat(40))).toBeNull();
	});

	it('classifies reddit comment threads as server-proxied embeds', () => {
		expect(embedSpecFor('https://www.reddit.com/r/askreddit/comments/abc123/a_title/')).toEqual({
			kind: 'server-oembed',
			url: 'https://www.reddit.com/r/askreddit/comments/abc123/a_title/'
		});
	});

	it('also classifies reddit share links (the /s/<id> short form)', () => {
		expect(embedSpecFor('https://www.reddit.com/r/freeuse/s/eBGQNK85qk')).toEqual({
			kind: 'server-oembed',
			url: 'https://www.reddit.com/r/freeuse/s/eBGQNK85qk'
		});
	});

	it('leaves reddit non-post pages as plain links', () => {
		expect(embedSpecFor('https://www.reddit.com/r/askreddit')).toBeNull();
		expect(embedSpecFor('https://www.reddit.com/user/someone')).toBeNull();
	});

	it('embeds direct image links from any host', () => {
		expect(embedSpecFor('https://i.imgur.com/photo.jpeg')).toEqual({
			kind: 'image',
			url: 'https://i.imgur.com/photo.jpeg'
		});
		expect(embedSpecFor('https://example.com/pic.PNG?size=large')).toMatchObject({ kind: 'image' });
	});

	it('does not treat query strings as image extensions', () => {
		expect(embedSpecFor('https://example.com/download?file=x.jpg')).toBeNull();
	});

	it('routes known noembed hosts to the aggregator', () => {
		for (const href of [
			'https://vimeo.com/123456',
			'https://open.spotify.com/track/abc',
			'https://x.com/user/status/123',
			'https://soundcloud.com/artist/song'
		]) {
			expect(embedSpecFor(href)).toEqual({
				kind: 'oembed',
				endpoint: `https://noembed.com/embed?url=${encodeURIComponent(href)}`
			});
		}
	});

	it('leaves unknown hosts as plain links', () => {
		expect(embedSpecFor('https://example.com/page')).toBeNull();
	});

	it('never classifies a non-http scheme as an embed', () => {
		expect(embedSpecFor('javascript:alert(1)')).toBeNull();
		expect(embedSpecFor('javascript://www.redgifs.com/watch/ok')).toBeNull();
		expect(embedSpecFor('data:image/png;base64,abcd')).toBeNull();
	});
});

describe('fetchOembed', () => {
	afterEach(() => clearOembedCache());

	it('reads the standard oembed fields and caches the result', async () => {
		const fetchMock = vi.fn(async () =>
			Response.json({
				title: 'A post',
				provider_name: 'Reddit',
				thumbnail_url: 'https://example.com/t.jpg',
				html: '<iframe src="https://embed.example.com"></iframe>'
			})
		);
		vi.stubGlobal('fetch', fetchMock);

		const result = await fetchOembed('https://noembed.test/1');
		expect(result).toEqual({
			title: 'A post',
			providerName: 'Reddit',
			description: null,
			thumbnailUrl: 'https://example.com/t.jpg',
			html: '<iframe src="https://embed.example.com"></iframe>',
			permalink: null,
			outbound: null,
			height: null
		});
		expect(cachedOembed('https://noembed.test/1')).toEqual(result);
	});

	it('drops a thumbnail that is not a safe http url', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Response.json({ title: 't', thumbnail_url: 'javascript:1' }))
		);
		const result = await fetchOembed('https://noembed.test/2');
		expect(result).not.toBe('error');
		if (result === 'error') throw new Error('expected oEmbed result');
		expect(result.thumbnailUrl).toBeNull();
	});

	it('caches failures as error rather than throwing or retrying', async () => {
		const fetchMock = vi.fn(async () => new Response('nope', { status: 500 }));
		vi.stubGlobal('fetch', fetchMock);
		await fetchOembed('https://noembed.test/3');
		await fetchOembed('https://noembed.test/3');
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(await fetchOembed('https://noembed.test/3')).toBe('error');
	});
});
