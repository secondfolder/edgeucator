# Messaging

Two linked partners can send each other private messages. The server stores a
copy of everything so that signing in on a new device restores the history, but
it stores only ciphertext.

The keys are [docs/encryption.md](encryption.md). The link between two accounts
is [docs/partners.md](partners.md). The body format is
[docs/rich-text.md](rich-text.md). This document is the messaging data model
and its rules.

## The shape of it

Deliberately not a chat log. The unit is a **thread**: a small, self-contained
exchange, a few replies at most, and next time you start a new one. The couple
has another channel for ordinary conversation; this is for the other thing.

A partner's messaging page is therefore a board of little stickers, one per
thread, rather than a scrolling transcript.

What the board shows depends on whether the recipient has ever opened that
thread. A never-opened unread thread shows as a sealed envelope to the
recipient only. Every other tile shows a small preview of the thread's first
message, decrypted in the browser after unlock, with the latest send date under
it and, for read threads whose latest message was first read on a later day, an
additional `opened …` line. When the first message already has cached embed
metadata, the board prefers that richer preview card instead of waiting for a
fresh embed lookup. A first message with text, or with more than one
attachment, is otherwise shown as a small fanned stack: the text sits in its
own bubble and up to the first few attachments sit behind it as thumbnails. The
fan uses the whole preview width, sits on a transparent preview background, and
spreads further apart on hover. An attachment-only first message with just one
attachment shows that thumbnail on its own, uncanted and cropped to fill the
whole preview area, instead of a generic "photo attached" label. While the
browser is still working out whether this device can open the history, the
board and thread render immediately with placeholder previews instead of a
full-page loading wall.

## Tables

| Table                      | What it holds                                                                                   |
| -------------------------- | ----------------------------------------------------------------------------------------------- |
| `message_threads`          | One exchange. Its sticker `icon`, plus two denormalised columns.                                |
| `messages`                 | One message. The body ciphertext, its format flag, plus an optional encrypted metadata sidecar. |
| `message_attachments`      | An encrypted file in the object store. Size and key only.                                       |
| `message_reactions`        | One tapback per user per message. Encrypted.                                                    |
| `message_tags`             | A reusable name and color scoped to one partnership.                                            |
| `message_thread_tags`      | The many-to-many assignment between threads and tags.                                           |
| `thread_reads`             | Per-user read state for one thread.                                                             |
| `history_restore_requests` | A partner asking to have the history re-encrypted.                                              |

Every foreign key cascades. Deleting a partnership takes its threads, messages,
attachments rows, reactions and read state with it — but **not** the objects in
the media store, which nothing cascades into. See "Media" below.

### Three decisions worth the argument

**`icon` is plaintext, from a closed list of sixteen.** This is now mostly a
legacy implementation detail: the current UI no longer lets a sender choose one,
and older threads' stored icons are ignored unless the recipient has never
opened that thread, in which case the board shows the generic sealed envelope.
The column still exists because the board has to show _something_ before a key
is unlocked and because removing it would need a migration rather than a UI
change.

The closed list is the load-bearing part. A free-text plaintext column reachable
from the network would be a covert channel for arbitrary prose, so `isThreadIcon`
is checked in `server/messaging.ts` as well as in the endpoint's Zod schema —
AGENTS.md invariant 14.

**Tags are an intentional plaintext exception.** A tag is reusable metadata for
finding and filtering threads later, so its name and color live in
`message_tags`, not in an encrypted message body. Tags are scoped by
`partnership_id`; the same name in two partnerships is two independent tags.
Names may contain spaces and emoji, are limited to 80 characters, and are unique
within their partnership. A random color is assigned when a tag is created, and
renaming or recoloring the tag updates every thread that uses it. The join table
keeps assignment separate from the definition so future tag filtering can query
threads without changing message rows.

**Reactions are encrypted.** The deliberate contrast with the icon, and what
makes both calls defensible: a reaction only ever renders inside a thread that
is already unlocked, so encrypting it costs nothing at all.

**Ciphertext columns are base64 `text`, not `blob`.** SvelteKit serialises load
data with devalue, which cannot carry a `Uint8Array`, so a blob column would
need base64 at the boundary regardless; and `text` round-trips identically
through libsql (dev and tests) and D1 (production), which a blob does not. The
33% overhead applies only to message bodies and their metadata sidecars —
attachments are raw bytes in the object store, where it would have mattered.
D1's per-value ceiling is 2,000,000 bytes and `MAX_CIPHERTEXT_BYTES` caps a
body at 64 KB.

**Message-derived metadata is encrypted beside the body, not stored in the clear.**
The `messages` row now has an optional `metadata_ciphertext` sidecar that holds
derived data such as cached embed previews. It is separate so the app can add
or backfill previews without rewriting the author-written body, and it is
encrypted because a cached title or thumbnail URL is still content derived from
plaintext the server must not keep in the clear.

## "Unread", defined once

For viewer `V` and thread `T`, with `R` = `V`'s `thread_reads` row if any:

```
unread(T, V)  ⟺  T.last_message_sender_id <> V
              AND (R is NULL OR T.last_message_at > R.last_read_message_at)
```

Two denormalised columns on the thread plus a left join. `messages` is never
read to draw a board, which is what keeps it one row per thread rather than one
per message — D1 bills on rows read.

The comparison is `>` and not `>=`, so a thread whose read mark equals its
newest message counts as read. Otherwise reopening a thread you had just read
would flicker it back to unread.

**The sender test is only sound because posting writes the sender's read row in
the same `db.batch()` as the message.** That is enforced in `sendMessage`, not
by the composer being unreachable from anywhere else, and it has its own test.

The same predicate appears twice — as SQL in `listBoard`/`listUnreadCounts`, and
as `isUnreadFor` in `src/lib/messaging.ts` for anything that needs it in
JavaScript. They have to agree, or `/home` and the board would disagree about
what is waiting for you.

## Board order

Unread first, newest at the top. Then a divider. Then the read ones, by the day
and time that the thread's **current latest message** was first read.

One SQL statement for both halves: `desc(unread)`, then a `CASE` picking
`last_message_at` for the unread half and `last_fully_read_at` for the read
half, then `id` purely as a tiebreak for two rows inside the same millisecond.
The application code uses the same idea as `lastFullyReadAt`.

`lastFullyReadAt` does **not** mean "the last time the page was opened". It
advances only when an unread latest message becomes read. Reopening a thread
with no new messages therefore leaves the board alone, while replying in it
advances your own read position because sending the latest message is also
reading it.

**In `listBoard`, the `thread_reads` user predicate belongs in the join's `ON`,
not the `WHERE`.** In the `WHERE` it silently turns the left join into an inner
one, and every thread the viewer has never opened disappears from their own
board — which is exactly the threads the feature exists to surface. There is a
test for it.

## Board tiles

Threads now sit in a plain grid rather than a jittered sticker layout. The
preview and timestamp lines want stable alignment more than they want novelty,
so the board no longer offsets or tilts each tile.

## Attachments and media

Each file is encrypted under **its own ephemeral age identity**, and that
identity travels inside the encrypted message body — rather than the file being
encrypted to the two partners directly.

That indirection is what makes partner-assisted recovery affordable: restoring
someone's history re-encrypts message _bodies_, a few kilobytes each, and never
touches the megabytes in the object store.

`message_attachments` deliberately holds **no filename and no mime type**. Both
live inside the encrypted body, so the server learns only that a file exists and
how many bytes it is.

**Objects are written before the database rows.** A crash between the two leaves
an orphaned encrypted blob — unreadable, and sweepable by prefix — rather than a
row pointing at an object that does not exist, which would be a permanently
broken message in someone's history.

Keys are `messages/<partnershipId>/<messageId>/<attachmentId>`, so disconnecting
can delete a partnership's media by prefix without enumerating rows. The key is
still stored on the row, so the layout can change without a migration.

## Links and embeds

Message text is still decrypted entirely in the browser. The server stores only
ciphertext for the body and metadata sidecar and never decides what a message
says.

URL detection happens after decryption in `MessageBubble.svelte` through
`RichText.svelte`, which tokenises the text with `linkifyjs` and emits escaped
text nodes plus real anchors. There is no `{@html}` path for message text.

Supported URLs then pass through `UrlEmbed.svelte`:

- Redgifs, YouTube, and direct image URLs become native embeds.
- A curated set of other hosts use `noembed.com` for metadata and, when its
  response contains a plain iframe, a sandboxed player.
- Unknown or dead providers stay plain links.

For new messages, and for older ones whose embeds the viewer explicitly
reveals, the browser may also ask the first-party `/api/embed-metadata`
endpoint to resolve preview data for supported URLs it already extracted from
the decrypted text. The response is encrypted into
`messages.metadata_ciphertext`, so later board renders can use the cached
preview without another metadata fetch. Inline message embeds use that same
encrypted cache too: when a message already has cached embed details,
`UrlEmbed.svelte` renders from them instead of starting a fresh metadata
request. Older rows are backfilled only per revealed URL, not automatically on
thread open while the user is still on the default manual mode, and a viewer
can manually refresh one cached URL entry from the embed itself if they want
fresh details.

Message threads can also switch to an auto-load mode from Encrypted messages.
Before a user answers, the third manual `Show` click on a device prompts them
with the privacy note: embed loading sends the URL to Bound Up's servers, but
those lookups are never logged. Opting in stores an account-wide preference and
the thread immediately renders skeletons for every supported URL, then activates
the real embed only when it is in or near the scrollport. Cached titles and
provider labels can appear in the skeleton immediately; iframe players and
third-party media stay deferred until activation.

Reddit is still the special case for live embeds. The browser cannot call
reddit's oEmbed endpoint directly because it is CORS-blocked, and `noembed.com`
does not support reddit, so the UI gates reddit expansion behind a `Show reddit
embed` button until the user has explicitly opted into automatic message-thread
embeds. Clicking that button, or auto-loading it later under that stored opt-in,
sends only the reddit URL to `/api/oembed`, which resolves share links to their
canonical post, fetches oEmbed server-side, and tries to extract the post's
outbound URL from the post RSS feed.

That outbound URL is what lets a reddit link post render the actual linked
media — especially a Redgifs player — instead of reddit's own NSFW preview
frame, which often serves a dead image. If there is no embeddable outbound URL,
the client falls back to `embed.reddit.com` for the reddit post itself.

## Partner-assisted history restore

A forgotten password loses the identity for good: the wrap is the only copy and
the password is the only key to it. But both people can already decrypt every
message in the partnership, so the _other_ one can re-encrypt it. The server
cannot help, and does not need to.

The flow, and the one security-critical part:

1. The person who lost their key gets a new identity and publishes its recipient.
2. They open a restore request carrying a **snapshot** of that recipient.
3. Their partner is shown the request and must compare the safety number **out
   of band** before confirming.
4. On confirm, the partner's device pages through every message body, encrypted
   metadata sidecar **and reaction** with its own identity, re-encrypts each to
   both recipients, and uploads the replacements a page at a time.

Reactions are included because they are encrypted too — a restore that skipped
them would hand back a readable history dotted with tapbacks the owner cannot
open.

Paging is a keyset cursor on `(created_at, id)`, not an `OFFSET`: an offset can
both skip and repeat a row if anything is written while the restore is in
flight. Each page is written back before the next is fetched, so a dropped
connection leaves the earlier pages already restored and the request still open;
running it again simply redoes the lot, which is harmless.

A body that will not open is **skipped rather than failed on**. If both partners
have reset at different times, a partnership can legitimately contain rows
readable by neither, and stopping there would mean no restore ever completes for
those two.

`GET .../restore` is unusual enough to state plainly: it returns the _entire_
shared history of a partnership as ciphertext. That is safe only because it goes
to somebody who is already a recipient on every one of those messages, so the
gate is not "are you a member" but "are you the member who did **not** raise
this request" — checked against the request row, never inferred from the caller.
The person who lost their key cannot read any of it, so a request from them is
either a bug or a stolen session, and it 404s.

Declining is a first-class answer, not tidiness: the out-of-band comparison is
the load-bearing step, and someone who finds the number does _not_ match needs a
way to say so that leaves the requester informed rather than waiting for ever.

Step 3 is load-bearing. Without the out-of-band check, a malicious server could
inject a request carrying its own recipient and have the partner re-encrypt the
entire history to it. The snapshot matters for the same reason: the
re-encryption targets exactly the recipient that was compared, not whatever
`user_keys` says at upload time.

Two honest caveats:

- **A restore lets your partner rewrite the shared history.** The server cannot
  verify that the new ciphertext says what the old one said — it cannot read
  either. This is not a new trust boundary, since the partner could always send
  whatever they liked, but it is worth knowing.
- **If both partners lose their passwords, the history is gone.** So is the
  history of anyone with no partner. There is no other copy.

## What the server still knows

Encrypting the content does not hide the shape of the conversation. Stated
plainly, because the framing of this feature invites the assumption that it does:

- That a partnership exchanges messages at all, and how many threads.
- Exactly when every thread started and every message was sent.
- Which side sent each message.
- The names and colors of the tags used by threads.
- How many attachments each message has, and **each one's exact byte size** — so
  approximate media sizes.
- When each side opened each thread, and when they last read it.
- Which of the sixteen stored icons a thread has, even though the current UI no
  longer surfaces that choice directly.

What it does not know: any message text, any filename, any file type, any
reaction, and anything that would let it read or forge any of them.

## Screens and endpoints

| Route                               | What                                                                        |
| ----------------------------------- | --------------------------------------------------------------------------- |
| `/partner/[id]/messages`            | The board. The unopened-envelope state SSRs; previews decrypt after unlock. |
| `/partner/[id]/messages/[threadId]` | One thread. Its load also records the open.                                 |
| `/home`                             | A link per partner with something waiting.                                  |
| `api/partnerships/[id]/threads`     | `POST` multipart: a thread and its first message.                           |
| `.../threads/[threadId]/messages`   | `POST` multipart: a reply.                                                  |
| `api/partnerships/[id]/tags`        | `GET` / `POST`: list or create partnership-scoped tags.                     |
| `.../tags/[tagId]`                  | `PATCH`: rename or recolor a tag.                                           |
| `.../threads/[threadId]/tags`       | `PUT`: replace the thread's tag assignments.                                |
| `.../messages/[messageId]/reaction` | `PUT` / `DELETE`.                                                           |
| `.../attachments/[attachmentId]`    | `GET`, streams ciphertext.                                                  |
| `.../ack-warning`                   | `POST`, the one-time warning acknowledgement.                               |
| `.../restore`                       | `GET` a page, `POST` re-encrypted rows, `DELETE`.                           |
| `.../events`                        | `GET`, the SSE feed. Metadata only.                                         |

**`src/routes/api/` sits outside both route groups deliberately.** A group guard
is a layout `+layout.server.ts`, and layout loads never run for a `+server.ts`
at all — so putting these under `(auth-required)` would advertise protection
that does not exist, which is worse than having none because the next reader
would trust it. Every handler carries its own `locals.user` check and its own
membership check.

**Neither page can SSR its content.** Bodies arrive as ciphertext and are
decrypted after hydration, so every bubble renders a placeholder first. The
ciphertext is never rendered as text, even for a frame — there is a component
test asserting exactly that, because it is the worst bug this feature could
have.

**This feature does not use superforms**, and that is the marker rather than an
omission: superforms exists to bind a `SuperValidated` to a `<form>` and
re-render errors from an action, and there is no action here — the body has to
be built in the browser because only the browser can encrypt it. Zod still
validates every field, in `src/lib/schemas/messageForm.ts`, imported by both the
endpoint and the client so a 25 MB refusal costs nothing.

### Attachment ids come from the client

The decryption keys live _inside_ the encrypted body, so the ids have to exist
before it is sealed. Letting the server assign them would mean either a second
round trip to re-seal the body or an unencrypted manifest. They travel alongside
the files as `fileIds`, in the same order, and the endpoint validates them as
UUIDs. Safe because they are only ever inserted: a duplicate collides with the
primary key, so a client-chosen id cannot reach or overwrite an existing row.

## Realtime

Both screens hold an `EventSource` against `.../events` and, on anything
arriving, call `invalidate()` on the `depends()` key the load already declares.
So a live update takes exactly the same authorised path as a navigation.

**Events carry metadata only, and that is a rule rather than a convention.** An
event is `{ kind, threadId }` — never a sender, never a byte of content. The
Durable Object therefore never handles message content, holds no storage, and
knows nothing but a partnership id. A future event wanting to carry a body is a
reason to stop and reconsider, not a small extension.

**SSE, not WebSocket**, for a decisive reason: `vite dev` cannot serve a
WebSocket upgrade from a `+server.ts` at all, so a socket would need a second
client code path used only in development — and the Playwright suite would then
never exercise the real one. An SSE stream is a plain streaming `Response` and
behaves identically in dev and on Workers.

The dev/prod switch mirrors `db/dev.ts` and `media/dev.ts`: a Durable Object in
production, a module-level `Map` under `vite dev`, which is genuinely correct
there because dev is one process.

### Hanging up when hidden is a billing necessity

A Durable Object is billed at 128 MB × wall-clock for as long as it holds an
in-flight request, and only _hibernation-eligible_ idleness is free —
hibernation needs the WebSocket Hibernation API, which SSE cannot use. One
permanently-open stream is roughly 10,800 GB-s a day: about **83% of the free
plan's 13,000 GB-s daily allowance, for a single partnership idling in a
background tab.**

So the client closes the stream on `visibilitychange`. The step that makes that
_safe_ is the reconnect: on becoming visible it refetches once,
unconditionally, before any event arrives. Anything that happened while hung up
was never delivered and never will be. **Do not remove one without the other.**

The same reasoning covers a client that stops reading without hanging up
(asleep, or behind a proxy that buffers `text/event-stream`): once its queue
fills, the object disconnects it rather than growing an unbounded queue, because
reconnecting refetches anyway.

`EventSource` retries by itself but eagerly and without a ceiling, so `onerror`
closes and reschedules by hand with exponential backoff and ±20% jitter. The
attempt counter resets **on the first message received**, not on connect: a
proxy that accepts the connection and then delivers nothing would otherwise
never look like a failure. After several consecutive failures the client falls
back to slow polling while visible, which is the honest answer to an
intermediary that buffers the stream for ever.

### The custom worker entry, and the trap in it

A Durable Object class has to be exported from the worker's own module, and the
SvelteKit adapter _generates_ that module — so `worker.ts` at the repo root
wraps it and re-exports the class.

**Do not point `main` at it.** `@sveltejs/adapter-cloudflare` treats `main` as
its _output_ path and `rimraf`s it before writing, so `"main": "worker.ts"`
makes `npm run build` delete the file. `main` stays on the adapter default and
wrangler takes the entry positionally instead — `wrangler dev worker.ts`,
`wrangler deploy worker.ts`, which is what `preview:worker` and `deploy` do.

`wrangler.jsonc` also gains a top-level `migrations` array, which has **nothing**
to do with `d1_databases[0].migrations_dir` beside it: that one is SQL applied by
`npm run db:migrate:d1`, this one is Durable Object class lifecycle. It declares
`new_sqlite_classes`, not `new_classes`, because SQLite-backed Durable Objects
are the only kind available on the Workers Free plan.

## Not built yet

The honest boundary:

- **Pins are per-device.** A new phone has seen no keys, so it trusts what it is
  first told — which is what "on first use" means, but it does mean a device
  change is indistinguishable from a substitution until the number is compared
  again. Surviving that needs `user_keys.sealed_pins` (the pin list encrypted to
  your own key), which is a noted follow-up. The UI shows when a key was first
  seen so "a moment ago" is not mistaken for "two years ago".
- **The Durable Object is not covered end to end.** The Playwright suite runs
  against `vite dev`, so the live-update tests exercise the in-process notifier.
  The object itself is covered by direct unit tests of the class
  (`durable-object.test.ts`), and `npm run preview:worker` confirms the custom
  entry builds, the `REALTIME` binding registers as a SQLite-backed class, and
  `GET .../events` reaches the worker and refuses an unauthenticated caller. An
  event has **not** been observed travelling through a real Durable Object,
  because a page cannot currently be loaded on the built worker at all — see the
  known bug at the end of AGENTS.md, which predates this work. Pointing
  Playwright at `wrangler dev` would close both gaps and is not done.
- **Video** is accepted and capped, but has had no real exercise beyond a unit
  test of the encryption; only a small PNG is covered end to end.

## The body is a rich-text document

A message body is a Lexical `editorState.toJSON()` document, not prose — see
[docs/rich-text.md](rich-text.md). Three consequences specific to messaging:

- **`MAX_BODY_CHARS` counts visible text**, via `documentToPlainText`, not the
  stored string. The document is several times the size of the prose it
  carries, so counting it would cut people off after a few hundred typed
  characters. A body over the limit is refused rather than truncated: a
  document cannot be cut at a character offset without corrupting it.
- **Ciphertext is bigger than it used to be.** `MAX_CIPHERTEXT_BYTES` (64 KB)
  has less headroom than when bodies were plain text.
- **`messages.body_format` is a second plaintext column**, `'plain' | 'lexical'`,
  and a closed list for the same reason `icon` is. It exists only so the server
  can tell a pre-rich-text body from a converted one, which it otherwise cannot
  do at all. It is temporary — see
  [docs/temporary-code.md](temporary-code.md).

### A sender may rewrite their own legacy bodies

`migrateMessageBodies` lets a client replace the ciphertext of messages **it
sent**, and only while `body_format = 'plain'`. As with a history restore, the
server cannot check that the new ciphertext says what the old one said; it
cannot read either. That is the same trust boundary already recorded above for
restores, narrowed further by being one-way: a converted row can never be
rewritten again, so this is not a general message-editing capability.
