import { embedSpecFor, isSafeHttpUrl, type CachedEmbedDetails } from '$lib/embeds';

const REDDIT_POST = /^https:\/\/(?:[a-z-]+\.)?reddit\.com\/r\/[^/]+\/(?:comments|s)\//i;
const REDDIT_SHARE = /^https:\/\/(?:[a-z-]+\.)?reddit\.com\/r\/[^/]+\/s\//i;
const USER_AGENT = 'BoundUp/1.0 (embed metadata)';

type FetchLike = typeof fetch;

type RedditOembedPayload = {
	title: string | null;
	providerName: string | null;
	description: string | null;
	thumbnailUrl: string | null;
	html: string | null;
	height: number | null;
	permalink: string | null;
	outbound: string | null;
};

function emptyPreview(href: string, fetchedAt: number): CachedEmbedDetails {
	return {
		href,
		fetchedAt,
		kind: 'card',
		providerName: null,
		title: null,
		description: null,
		thumbnailUrl: null,
		canonicalUrl: href,
		imageUrl: null,
		iframeSrc: null,
		iframeHeight: null,
		faviconUrl: null,
		themeColor: null
	};
}

function safeUrl(value: unknown): string | null {
	return typeof value === 'string' && isSafeHttpUrl(value) ? value : null;
}

function stringValue(record: Record<string, unknown>, key: string): string | null {
	return typeof record[key] === 'string' ? record[key] : null;
}

function numberValue(record: Record<string, unknown>, key: string): number | null {
	return typeof record[key] === 'number' ? record[key] : null;
}

function providerNameForIframe(src: string, href: string): string | null {
	const host = new URL(src).hostname.toLowerCase();
	if (host.includes('youtube')) return 'YouTube';
	if (host.includes('redgifs')) return 'Redgifs';
	return providerNameForUrl(href);
}

function providerNameForUrl(href: string): string | null {
	const host = new URL(href).hostname.toLowerCase();
	if (host === 'youtu.be' || host.includes('youtube')) return 'YouTube';
	if (host.includes('redgifs')) return 'Redgifs';
	if (host.includes('reddit')) return 'Reddit';
	if (host.startsWith('www.')) return host.slice(4);
	return host;
}

function iframeFromHtml(html: string | null): { src: string; height: number | null } | null {
	if (!html) return null;
	const match = html.match(/<iframe[^>]*\ssrc=["']([^"']+)["']/i);
	if (!match || !isSafeHttpUrl(match[1] ?? '')) return null;
	return { src: match[1] as string, height: null };
}

function normaliseOutboundCandidate(candidate: string): string | null {
	const cleaned = candidate.replaceAll('&amp;', '&').split('&quot;')[0].split('&lt;')[0].trim();
	try {
		return new URL(cleaned).href;
	} catch {
		return null;
	}
}

async function resolveShareLink(target: string, fetchFn: FetchLike): Promise<string> {
	if (!REDDIT_SHARE.test(target)) return target;
	const response = await fetchFn(target, {
		redirect: 'manual',
		headers: { 'user-agent': USER_AGENT }
	});
	const location = response.headers.get('location');
	if (location && REDDIT_POST.test(location)) return location;
	throw new Error('share link did not resolve to a post');
}

async function outboundLink(permalink: string, fetchFn: FetchLike): Promise<string | null> {
	const path = new URL(permalink).pathname.replace(/\/$/, '');
	const variants = [
		`https://www.reddit.com${path}.rss?utm_source=embed&cb=${Date.now()}`,
		`https://www.reddit.com${path}.rss?cb=${Date.now()}`,
		`https://www.reddit.com${path}.rss?utm_source=embed`,
		`https://www.reddit.com${path}.rss`
	];

	let xml: string | null = null;
	for (const variant of variants) {
		const response = await fetchFn(variant, {
			headers: { 'user-agent': USER_AGENT, accept: 'application/xml' }
		});
		if (!response.ok) continue;
		xml = await response.text();
		break;
	}
	if (xml === null) return null;

	const urls = [...xml.matchAll(/https?:\/\/(?:[^\s"'<>]|&amp;|&quot;|&lt;)+/gi)]
		.map((match) => normaliseOutboundCandidate(match[0]))
		.filter((candidate): candidate is string => candidate !== null)
		.filter((candidate) => !/https?:\/\/(?:www\.)?reddit\.com\//i.test(candidate))
		.filter((candidate) => !/https?:\/\/[a-z.]*redd\.it\//i.test(candidate))
		.filter((candidate) => !/https?:\/\/(?:www\.)?w3\.org\//i.test(candidate))
		.filter((candidate) => !/https?:\/\/search\.yahoo\.com\//i.test(candidate))
		.filter((candidate) => !/https?:\/\/(?:[^/]+\.)?redditstatic\.com\//i.test(candidate))
		.filter((candidate) => !/https?:\/\/(?:[^/]+\.)?redditmedia\.com\//i.test(candidate));

	const redgifs = urls.find((candidate) =>
		/^https?:\/\/(?:www\.)?redgifs\.com\/(?:watch|ifr)\//i.test(candidate)
	);
	if (redgifs) return redgifs;
	return urls[0] ?? null;
}

export function isSupportedRedditEmbedUrl(href: string): boolean {
	return REDDIT_POST.test(href);
}

export async function fetchRedditOembedPayload(
	requested: string,
	fetchFn: FetchLike
): Promise<RedditOembedPayload | null> {
	if (!REDDIT_POST.test(requested)) return null;

	let target: string;
	try {
		target = await resolveShareLink(requested, fetchFn);
	} catch {
		return null;
	}

	const upstream = await fetchFn(
		`https://www.reddit.com/oembed?url=${encodeURIComponent(target)}`,
		{
			headers: {
				'user-agent': USER_AGENT,
				accept: 'application/json'
			}
		}
	);

	const payload: Record<string, unknown> = upstream.ok
		? ((await upstream.json()) as Record<string, unknown>)
		: {};
	const permalink = target;
	const outbound = await outboundLink(target, fetchFn);
	return {
		title: stringValue(payload, 'title'),
		providerName: stringValue(payload, 'provider_name'),
		description: stringValue(payload, 'description'),
		thumbnailUrl: safeUrl(payload['thumbnail_url']),
		html: stringValue(payload, 'html'),
		height: numberValue(payload, 'height'),
		permalink,
		outbound
	};
}

async function fetchNoembedPreview(
	href: string,
	endpoint: string,
	fetchFn: FetchLike,
	fetchedAt: number
): Promise<CachedEmbedDetails | null> {
	const response = await fetchFn(endpoint, { headers: { accept: 'application/json' } });
	if (!response.ok) return null;
	const data = (await response.json()) as Record<string, unknown>;
	const title = stringValue(data, 'title');
	const providerName = stringValue(data, 'provider_name');
	const description = stringValue(data, 'description');
	const thumbnailUrl = safeUrl(data['thumbnail_url']);
	const canonicalUrl = safeUrl(data['url']) ?? href;
	const iframe = iframeFromHtml(stringValue(data, 'html'));
	const height = numberValue(data, 'height');
	if (!title && !providerName && !description && !thumbnailUrl && !iframe) return null;
	return {
		...emptyPreview(href, fetchedAt),
		kind: iframe ? 'iframe' : 'card',
		providerName,
		title,
		description,
		thumbnailUrl,
		canonicalUrl,
		iframeSrc: iframe?.src ?? null,
		iframeHeight: height ?? iframe?.height ?? null
	};
}

export async function fetchEmbedMetadata(
	href: string,
	fetchFn: FetchLike
): Promise<CachedEmbedDetails | null> {
	if (!isSafeHttpUrl(href)) return null;
	const spec = embedSpecFor(href);
	if (!spec) return null;

	const fetchedAt = Date.now();
	if (spec.kind === 'image') {
		return {
			...emptyPreview(href, fetchedAt),
			kind: 'image',
			thumbnailUrl: spec.url,
			imageUrl: spec.url
		};
	}

	if (spec.kind === 'iframe') {
		return {
			...emptyPreview(href, fetchedAt),
			kind: 'iframe',
			providerName: providerNameForIframe(spec.src, href),
			title: spec.title,
			iframeSrc: spec.src
		};
	}

	if (spec.kind === 'oembed') {
		try {
			return await fetchNoembedPreview(href, spec.endpoint, fetchFn, fetchedAt);
		} catch {
			return null;
		}
	}

	const reddit = await fetchRedditOembedPayload(href, fetchFn);
	if (!reddit) return null;
	const preview = emptyPreview(href, fetchedAt);
	const outbound = reddit.outbound ? embedSpecFor(reddit.outbound) : null;
	if (outbound?.kind === 'image') {
		return {
			...preview,
			kind: 'image',
			providerName: reddit.providerName,
			title: reddit.title,
			description: reddit.description,
			thumbnailUrl: outbound.url,
			canonicalUrl: reddit.permalink ?? href,
			imageUrl: outbound.url
		};
	}
	if (outbound?.kind === 'iframe') {
		return {
			...preview,
			kind: 'iframe',
			providerName: reddit.providerName ?? providerNameForUrl(reddit.outbound ?? href),
			title: reddit.title ?? outbound.title,
			description: reddit.description,
			thumbnailUrl: reddit.thumbnailUrl,
			canonicalUrl: reddit.permalink ?? href,
			iframeSrc: outbound.src
		};
	}
	if (!reddit.title && !reddit.providerName && !reddit.thumbnailUrl) return null;
	return {
		...preview,
		kind: 'card',
		providerName: reddit.providerName,
		title: reddit.title,
		description: reddit.description,
		thumbnailUrl: reddit.thumbnailUrl,
		canonicalUrl: reddit.permalink ?? href
	};
}
