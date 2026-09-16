import { json } from '@sveltejs/kit';
import { fetchRedditOembedPayload, isSupportedRedditEmbedUrl } from '$lib/server/embed-metadata';
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
export const GET: RequestHandler = async ({ url, locals, fetch }) => {
	if (!locals.user) {
		return json({ error: 'unauthorised' }, { status: 401 });
	}

	const requested = url.searchParams.get('url');
	if (!requested || !isSupportedRedditEmbedUrl(requested)) {
		return json({ error: 'unsupported url' }, { status: 400 });
	}

	const payload = await fetchRedditOembedPayload(requested, fetch);
	if (!payload) {
		return json({ error: 'could not resolve link' }, { status: 502 });
	}

	// The browser already has an in-page cache in src/lib/embeds.ts, and these
	// responses are derived from private decrypted message text. Storing them in
	// HTTP caches only creates stale dev behaviour and buys nothing.
	return json(payload, { headers: { 'cache-control': 'no-store' } });
};
