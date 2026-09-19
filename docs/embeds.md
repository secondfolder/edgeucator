# Embeds

URL rendering is split into two jobs:

1. `RichText.svelte` tokenises prose with `linkifyjs` and emits escaped text
   nodes plus real anchors.
2. `UrlEmbed.svelte` decides whether a URL becomes an inline embed, a metadata
   card, or stays a plain link.

For messages specifically, there is now a third piece in the flow: the browser
may cache resolved preview data for supported URLs in an encrypted
`metadataCiphertext` sidecar on the message row. That cache is used first for
board previews and inline message embeds, and is filled at send time for new
messages. Older rows are backfilled only when the viewer explicitly presses the
embed's `Show` button for a URL that does not already have a cached entry.

There is also a per-account auto-load preference for message-thread embeds.
Until a user answers it, message threads stay on the manual `Show` path. On a
device where they have never answered before, the third `Show` click opens a
small consent dialog explaining that loading embeds sends the URL to Bound Up's
servers and that those lookups are never logged. Saying yes stores an account-
wide opt-in and this device immediately starts auto-loading message-thread
embeds; saying no stores an account-wide opt-out and the prompt does not return.

The current scope is every prose field the app renders for a user: message
bodies, task titles and descriptions, task-completion messages, reward titles
and descriptions, reward history descriptions, and edge-task reveal prose.
Identifier fields are deliberately excluded: partner names, email addresses,
passkey names, thread tags, attachment filenames, and guide titles are still
plain text.

## Providers

The provider map is deliberately small and explicit where the payoff is high:

- Redgifs: `redgifs.com/watch/<id>` and `redgifs.com/ifr/<id>` become the
  documented `https://www.redgifs.com/ifr/<id>` player.
- YouTube: `youtube.com/watch?v=...`, `youtu.be/...`, and Shorts URLs become a
  `youtube-nocookie.com` player.
- Direct image URLs: known image extensions (`jpg`, `png`, `gif`, `webp`,
  `avif`) become plain `<img>` embeds.
- Reddit: post permalinks and share links go through the special path below.
- A curated set of other hosts goes through `https://noembed.com/embed?url=...`
  for metadata and, when the returned HTML contains a plain iframe, a
  sandboxed player.

If a host is unknown, if a provider is down, or if the response does not hand
back a directly usable iframe, the URL still renders as a normal clickable
link. The failure mode is always "link still works", never a broken message.

## Reddit

Reddit is the awkward one.

The browser cannot fetch reddit's oEmbed endpoint directly because
`https://www.reddit.com/oembed?url=...` sends no CORS headers, and
`noembed.com` does not support reddit at all. So reddit URLs are the one case
that may reach the server.

That is not automatic for the live embed path unless the viewer has explicitly
opted into automatic message-thread embeds.

- A reddit URL first renders as a link plus a `Show reddit embed` button.
- Only when the viewer clicks that button does the client call `/api/oembed`.
- `/api/oembed` accepts only reddit post URLs, requires a session, resolves
  share links (`/r/<sub>/s/<id>`) to their canonical comment thread, and fetches
  reddit's oEmbed server-side.

The proxy returns two things the client cares about:

- `permalink`: the canonical reddit post URL.
- `outbound`: the URL the reddit post links to, extracted from the post's RSS
  entry when one exists.

`outbound` matters because reddit's own embed frame serves dead preview images
for some NSFW posts. When the post links to something we already embed natively

- the important case here is Redgifs - the client uses that outbound URL and
  renders the real media instead of the reddit frame. If there is no embeddable
  outbound URL, the client falls back to `embed.reddit.com` for the post itself.

This is still the only place where a reddit URL is sent for a live embed. By
default the click gate keeps that explicit. After a user opts into automatic
message-thread embeds, the same request may happen automatically once the embed
is near the viewport.

Message metadata caching widens the privacy boundary deliberately: at send time,
and when a viewer explicitly presses `Show` for an older uncached message URL,
the browser may send that supported URL to `/api/embed-metadata` so Bound Up
can resolve a first-party preview and the client can encrypt it into the
message's metadata sidecar. After a viewer opts into automatic message-thread
embeds, the browser may also make that request on thread open for embeds that
are actually on screen or about to be. The database still stores only
ciphertext for that sidecar.

## Safety model

Two rules carry the security weight:

1. Only `http:` and `https:` URLs are ever allowed through to `href`, `src`, or
   iframe URLs. `javascript:`, `data:`, `vbscript:` and similar schemes are
   rejected before rendering.
2. The app no longer renders third-party embed HTML with `{@html}`. For
   generic oEmbed providers it will only extract a plain iframe `src` and
   sandbox that iframe itself; richer HTML falls back to a metadata card.

The iframe sandbox is the same posture used for the rest of the app's hosted
players: scripts may run inside the embedded origin, but the frame cannot
navigate the top page away.

## Caching

`src/lib/embeds.ts` keeps a module-level cache of oEmbed responses in the
browser. Re-renders and `invalidate()` calls reuse the cached response instead
of hitting the same provider repeatedly.

Messages now also have a persistent encrypted cache in `messages.metadata_ciphertext`.
New sends try to fill it before posting the message. Older rows fill it only
for URLs the viewer explicitly reveals and only when no cached entry for that
URL exists yet. Once a cached entry exists it is reused by default, but the
embed also offers a small manual refresh button so the viewer can ask for fresh
details and rewrite just that one cached URL entry.

`user_keys.embed_auto_load` stores the account-wide default for message-thread
embeds: `NULL` means no answer yet, `1` means auto-load, `0` means stay manual.
The initial prompt threshold is device-local, stored in localStorage, so one
phone can ask after three manual reveals without forcing the same prompt to pop
immediately on another.

When auto-load is on, `UrlEmbed.svelte` still does not activate every embed at
once. It first renders stable skeletons for every supported URL in the thread,
using any cached title/provider details it already has while withholding the
iframe or remote image itself. A small `IntersectionObserver` scheduler then
starts the real fetch only when the embed is in or near the scrollport. Faster
scroll velocity adds a short delay; if the user stops with the embed still near
view, that delay collapses so the embed can load promptly where they actually
paused.

Failures are cached too as `'error'`, because a dead provider should degrade to
one quiet plain link, not a refetch storm.
