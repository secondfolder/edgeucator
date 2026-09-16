import { find as findLinks } from 'linkifyjs';

/**
 * URL → embed classification, plus the oEmbed fetch with its module cache.
 *
 * Pure string/URL logic only, so it runs anywhere (SSR, jsdom, node tests).
 * The fetch half uses global `fetch` and is only ever called from the browser
 * after mount — never during SSR or prerender, so no third-party request
 * happens on the server.
 *
 * Provider strategy: a curated map covers the hosts we care most about
 * (redgifs, reddit, youtube, direct images) with zero third-party calls or
 * keys; everything else goes through noembed.com, a free keyless oEmbed
 * aggregator, and any host it does not know simply stays a plain link.
 * No paid service, no API keys, and failures degrade silently to a link.
 */

export type EmbedSpec =
	| { kind: 'image'; url: string }
	| { kind: 'iframe'; src: string; title: string }
	| { kind: 'oembed'; endpoint: string }
	| { kind: 'server-oembed'; url: string };

export type CachedEmbedDetails = {
	href: string;
	fetchedAt: number;
	kind: 'image' | 'iframe' | 'card';
	providerName: string | null;
	title: string | null;
	description: string | null;
	thumbnailUrl: string | null;
	canonicalUrl: string | null;
	imageUrl: string | null;
	iframeSrc: string | null;
	iframeHeight: number | null;
	faviconUrl: string | null;
	themeColor: string | null;
};

export type ResolvedLinkMatch = {
	value: string;
	href: string;
	start: number;
	end: number;
	embed: EmbedSpec | null;
};

/** Hosts noembed.com is known to cover well; anything else stays a plain link. */
const NOEMBED_HOSTS = new Set([
	'vimeo.com',
	'player.vimeo.com',
	'soundcloud.com',
	'www.soundcloud.com',
	'open.spotify.com',
	'x.com',
	'www.x.com',
	'twitter.com',
	'www.twitter.com',
	'imgur.com',
	'www.imgur.com',
	'tiktok.com',
	'www.tiktok.com',
	'instagram.com',
	'www.instagram.com',
	'dailymotion.com',
	'www.dailymotion.com',
	'twitch.tv',
	'www.twitch.tv',
	'streamable.com',
	'www.streamable.com',
	'bandcamp.com',
	'www.bandcamp.com'
]);

const IMAGE_EXTENSION = /\.(?:jpe?g|png|gif|webp|avif)(?:[?#]|$)/i;

/**
 * `http:`/`https:` only. Everything else — `javascript:`, `data:`, `vbscript:`
 * — is rejected here so no non-web scheme ever reaches an href or an iframe
 * src. Message text is partner-controlled input; this is the gate.
 */
export function isSafeHttpUrl(href: string): boolean {
	if (!/^https?:\/\//i.test(href)) return false;
	try {
		const url = new URL(href);
		return url.protocol === 'http:' || url.protocol === 'https:';
	} catch {
		return false;
	}
}

/** `redgifs.com/watch/<id>` (and `/ifr/<id>`) → the documented player iframe. */
function redgifsSpec(url: URL): EmbedSpec | null {
	const match = url.pathname.match(/^\/(?:watch|ifr)\/([a-z0-9-]+)/i);
	if (!match) return null;
	// Redgifs' own embed path. No API call, no key — this is the player they
	// hand out for exactly this purpose.
	return {
		kind: 'iframe',
		src: `https://www.redgifs.com/ifr/${match[1]}`,
		title: 'Redgifs video'
	};
}

function youtubeSpec(url: URL): EmbedSpec | null {
	let id: string | null = null;
	if (url.hostname === 'youtu.be') {
		id = url.pathname.slice(1).split('/')[0] || null;
	} else if (/(?:^|\.)youtube\.com$/i.test(url.hostname)) {
		const v = url.searchParams.get('v');
		if (v) {
			id = v;
		} else {
			const shorts = url.pathname.match(/^\/shorts\/([a-zA-Z0-9_-]+)/);
			if (shorts) id = shorts[1];
		}
	}
	if (!id || !/^[a-zA-Z0-9_-]{6,20}$/.test(id)) return null;
	// -nocookie keeps the player off the tracking domain; it is the same player.
	return {
		kind: 'iframe',
		src: `https://www.youtube-nocookie.com/embed/${id}`,
		title: 'YouTube video'
	};
}

/**
 * Reddit embeddable pages: comment threads and share links (the `/r/<sub>/s/<id>`
 * short form the share button produces).
 *
 * Reddit's oEmbed endpoint works but is CORS-blocked, so these resolve
 * through our own `/api/oembed` proxy — which means the URL reaches the
 * server. Because message plaintext never otherwise touches the server (see
 * docs/privacy.md), UrlEmbed gates this kind behind an explicit click: the
 * link is sent only when the viewer asks for the embed.
 */
function redditSpec(url: URL): EmbedSpec | null {
	if (!/(?:^|\.)reddit\.com$/i.test(url.hostname)) return null;
	if (!/\/(?:comments|s)\//.test(url.pathname)) return null;
	return { kind: 'server-oembed', url: url.href };
}

/**
 * Classify a URL into an embed, or null to leave it as a plain link.
 * The scheme check runs first — see isSafeHttpUrl.
 */
export function embedSpecFor(href: string): EmbedSpec | null {
	if (!isSafeHttpUrl(href)) return null;
	let url: URL;
	try {
		url = new URL(href);
	} catch {
		return null;
	}
	const host = url.hostname.toLowerCase();

	if (host === 'redgifs.com' || host === 'www.redgifs.com') {
		const spec = redgifsSpec(url);
		if (spec) return spec;
		return null;
	}
	if (
		host === 'youtu.be' ||
		/(^|\.)youtube\.com$/.test(host) ||
		/(^|\.)youtube-nocookie\.com$/.test(host)
	) {
		const spec = youtubeSpec(url);
		if (spec) return spec;
		return null;
	}
	if (/(^|\.)reddit\.com$/.test(host)) {
		const spec = redditSpec(url);
		if (spec) return spec;
		return null;
	}
	// Direct image links embed natively — most often Imgur/i.imgur, but any
	// host serving a known image extension counts.
	if (IMAGE_EXTENSION.test(url.pathname)) {
		return { kind: 'image', url: url.href };
	}
	if (NOEMBED_HOSTS.has(host)) {
		return {
			kind: 'oembed',
			endpoint: `https://noembed.com/embed?url=${encodeURIComponent(url.href)}`
		};
	}
	return null;
}

/**
 * The safe, normalised URLs a piece of text contains, plus their embed class.
 *
 * RichText renders from this, and message-metadata caching reuses the same
 * function so the set of URLs that gets cached cannot drift from the set the
 * UI later tries to render.
 */
export function findRenderableLinks(text: string, maxEmbeds = Infinity): ResolvedLinkMatch[] {
	const found = findLinks(text).filter(
		(match) => match.type === 'url' && isSafeHttpUrl(match.href)
	);

	const result: ResolvedLinkMatch[] = [];
	let embedsUsed = 0;
	for (const match of found) {
		const embed = embedsUsed < maxEmbeds ? embedSpecFor(match.href) : null;
		if (embed) embedsUsed += 1;
		result.push({
			value: match.value,
			href: match.href,
			start: match.start,
			end: match.end,
			embed
		});
	}
	return result;
}

export interface OembedResult {
	title: string | null;
	providerName: string | null;
	description: string | null;
	thumbnailUrl: string | null;
	/** Raw `html` from the provider. Sanitised before it is ever rendered. */
	html: string | null;
	/** Provider-suggested frame height in px, when it sends one. */
	height: number | null;
	/**
	 * Canonical permalink, sent only by our own proxy (reddit): the resolved
	 * comments URL the client frames directly at embed.reddit.com. The oEmbed
	 * `html` path cannot be used for reddit — its widget script dies in a
	 * sandboxed srcdoc frame and reddit's frame-ancestors rejects srcdoc
	 * parents — so the client frames the permalink instead, the same posture
	 * as the redgifs player.
	 */
	permalink: string | null;
	/**
	 * The URL the post links out to (redgifs video, article, …), sent only by
	 * our proxy from the post's RSS entry. When the client can embed it
	 * natively it does — reddit's own frame serves dead previews for NSFW
	 * posts, so the outbound link is the only way to show the actual media.
	 */
	outbound: string | null;
}

/**
 * Module-level cache: messages re-render on every invalidate() and the board
 * can show the same URL many times, but each URL only needs one fetch per
 * page load. Failures are cached too ('error') so a dead provider is not
 * re-hit for every message.
 */
const oembedCache = new Map<string, OembedResult | 'error'>();

export function cachedOembed(endpoint: string): OembedResult | 'error' | undefined {
	return oembedCache.get(endpoint);
}

export async function fetchOembed(endpoint: string): Promise<OembedResult | 'error'> {
	const cached = oembedCache.get(endpoint);
	if (cached) return cached;
	try {
		const response = await fetch(endpoint, { headers: { accept: 'application/json' } });
		if (!response.ok) throw new Error(`oembed ${response.status}`);
		const data: unknown = await response.json();
		if (typeof data !== 'object' || data === null || !('html' in data || 'title' in data)) {
			throw new Error('oembed payload unrecognised');
		}
		const record = data as Record<string, unknown>;
		const result: OembedResult = {
			title: typeof record.title === 'string' ? record.title : null,
			providerName: typeof record.provider_name === 'string' ? record.provider_name : null,
			description: typeof record.description === 'string' ? record.description : null,
			thumbnailUrl:
				typeof record.thumbnail_url === 'string' && isSafeHttpUrl(record.thumbnail_url)
					? record.thumbnail_url
					: null,
			// The html is partner-influenced third-party input; UrlEmbed runs it
			// through DOMPurify before it touches the DOM.
			html: typeof record.html === 'string' ? record.html : null,
			height: typeof record.height === 'number' ? record.height : null,
			permalink:
				typeof record.permalink === 'string' && isSafeHttpUrl(record.permalink)
					? record.permalink
					: null,
			outbound:
				typeof record.outbound === 'string' && isSafeHttpUrl(record.outbound)
					? record.outbound
					: null
		};
		oembedCache.set(endpoint, result);
		return result;
	} catch {
		// Swallowed on purpose: the caller falls back to a plain link, and
		// logging would trip the e2e console-error net for an expected
		// third-party outage.
		oembedCache.set(endpoint, 'error');
		return 'error';
	}
}

/** Test hook: clear the module cache between cases. */
export function clearOembedCache(): void {
	oembedCache.clear();
}
