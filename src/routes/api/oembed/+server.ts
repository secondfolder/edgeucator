import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * The server-side oEmbed proxy — the only way reddit links can embed.
 *
 * Reddit's oEmbed endpoint (`https://www.reddit.com/oembed?url=…`) is free and
 * keyless, but sends no CORS headers, so the browser cannot call it directly
 * (verified: no `access-control-allow-origin` on any response). noembed.com —
 * our fallback for other hosts — does not support reddit at all. So reddit
 * resolves through here, same-origin.
 *
 * Privacy: this endpoint is the one place a URL from decrypted message
 * plaintext reaches the server, which otherwise never learns message content
 * (see docs/privacy.md). Two mitigations, deliberately:
 *
 * 1. The client only calls this after an explicit click on the embed
 *    placeholder — UrlEmbed gates `server-oembed` links behind user action.
 * 2. This handler whitelists reddit post URLs only, so it is not an open
 *    proxy, and it requires a session.
 *
 * Note it lives at the route root rather than under a `(group)`: the auth
 * check is `locals.user`, because form-action-style group guards do not apply
 * to `+server.ts` endpoints either way.
 */

const REDDIT_POST = /^https:\/\/(?:[a-z-]+\.)?reddit\.com\/r\/[^/]+\/(?:comments|s)\//i;
const REDDIT_SHARE = /^https:\/\/(?:[a-z-]+\.)?reddit\.com\/r\/[^/]+\/s\//i;
const USER_AGENT = 'BoundUp/1.0 (embed proxy)';

function normaliseOutboundCandidate(candidate: string): string | null {
	const cleaned = candidate.replaceAll('&amp;', '&').split('&quot;')[0].split('&lt;')[0].trim();
	try {
		return new URL(cleaned).href;
	} catch {
		return null;
	}
}

/**
 * Share links (`/r/<sub>/s/<id>`) are the short form reddit's own share button
 * produces, but reddit's oEmbed endpoint rejects them outright ("invalid URL
 * value", 400 — verified). They do, however, 301 to the full comments URL, so
 * resolve that redirect here and embed the canonical URL. One extra request,
 * `redirect: 'manual'` so we never download the page it points at.
 */
async function resolveShareLink(target: string): Promise<string> {
	if (!REDDIT_SHARE.test(target)) return target;
	const response = await fetch(target, {
		redirect: 'manual',
		headers: { 'user-agent': USER_AGENT }
	});
	const location = response.headers.get('location');
	if (location && REDDIT_POST.test(location)) return location;
	throw new Error('share link did not resolve to a post');
}

/**
 * The post's outbound link — the URL a link post points at (a redgifs
 * video, an article, …), which is what should actually be embedded.
 *
 * Reddit's JSON API is 403-blocked for us, but its RSS feeds are not, and the
 * post's own feed entry anchors the outbound URL with a `[link]` label. One
 * regex on the escaped entry HTML beats a scraper.
 */
async function outboundLink(permalink: string): Promise<string | null> {
	// Pathname only — share links resolve with ?share_id=…&utm… query strings,
	// and `.rss` appended after a query string is silently ignored.
	const path = new URL(permalink).pathname.replace(/\/$/, '');
	// Reddit's RSS endpoint rate-limits aggressively, and one path variant can
	// 429 while another returns the same feed. Try a few query-string variants
	// before giving up.
	const variants = [
		`https://www.reddit.com${path}.rss?utm_source=embed&cb=${Date.now()}`,
		`https://www.reddit.com${path}.rss?cb=${Date.now()}`,
		`https://www.reddit.com${path}.rss?utm_source=embed`,
		`https://www.reddit.com${path}.rss`
	];

	let xml: string | null = null;
	for (const variant of variants) {
		const response = await fetch(variant, {
			headers: { 'user-agent': USER_AGENT, accept: 'application/xml' }
		});
		if (!response.ok) continue;
		xml = await response.text();
		break;
	}
	if (xml === null) return null;
	// The RSS entry escapes its inner HTML and the exact `[link]` anchor shape
	// is not stable enough to trust across every post shape. What *is* stable is
	// that the post's outbound URL appears verbatim in the feed body. So scan for
	// non-reddit URLs, prefer a Redgifs watch link when present, and otherwise
	// use the first non-reddit URL as the post target.
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

export const GET: RequestHandler = async ({ url, locals, fetch }) => {
	if (!locals.user) {
		return json({ error: 'unauthorised' }, { status: 401 });
	}

	const requested = url.searchParams.get('url');
	if (!requested || !REDDIT_POST.test(requested)) {
		return json({ error: 'unsupported url' }, { status: 400 });
	}

	let target: string;
	try {
		target = await resolveShareLink(requested);
	} catch {
		return json({ error: 'could not resolve link' }, { status: 502 });
	}

	const upstream = await fetch(`https://www.reddit.com/oembed?url=${encodeURIComponent(target)}`, {
		headers: {
			// Reddit 403s requests with no UA; a descriptive one is also what
			// their API rules ask for.
			'user-agent': USER_AGENT,
			accept: 'application/json'
		}
	});

	// The oEmbed payload gives the client its title card. The permalink is
	// the important half: the client frames embed.reddit.com directly, because
	// the oEmbed `html` widget script cannot run sandboxed (reddit's
	// frame-ancestors rejects srcdoc parents) — see UrlEmbed.svelte. The
	// outbound link, when the post has an embeddable one, lets the client
	// render its own native player instead of reddit's frame (which serves
	// dead previews for NSFW posts).
	const payload: Record<string, unknown> = upstream.ok
		? ((await upstream.json()) as Record<string, unknown>)
		: {};
	payload['permalink'] = target;
	payload['outbound'] = await outboundLink(target);

	// The browser already has an in-page cache in src/lib/embeds.ts, and these
	// responses are derived from private decrypted message text. Storing them in
	// HTTP caches only creates stale dev behaviour and buys nothing.
	return json(payload, { headers: { 'cache-control': 'no-store' } });
};
