# Embeds

URL rendering is split into two jobs:

1. `RichText.svelte` tokenises prose with `linkifyjs` and emits escaped text
   nodes plus real anchors.
2. `UrlEmbed.svelte` decides whether a URL becomes an inline embed, a metadata
   card, or stays a plain link.

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

That is not automatic.

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

This is the only place where decrypted message text can be sent back to the
server, and only a URL fragment at that. The click gate is there specifically
so this is explicit user action rather than background behaviour.

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

Failures are cached too as `'error'`, because a dead provider should degrade to
one quiet plain link, not a refetch storm.
