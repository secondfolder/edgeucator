# Messaging

Two linked partners can send each other private messages. The server stores a
copy of everything so that signing in on a new device restores the history, but
it stores only ciphertext.

The keys are [docs/encryption.md](encryption.md). The link between two accounts
is [docs/partners.md](partners.md). This document is the messaging data model
and its rules.

## The shape of it

Deliberately not a chat log. The unit is a **thread**: a small, self-contained
exchange, a few replies at most, and next time you start a new one. The couple
has another channel for ordinary conversation; this is for the other thing.

A partner's messaging page is therefore a board of little stickers, one per
thread, rather than a scrolling transcript.

## Tables

| Table                      | What it holds                                                    |
| -------------------------- | ---------------------------------------------------------------- |
| `message_threads`          | One exchange. Its sticker `icon`, plus two denormalised columns. |
| `messages`                 | One message. `ciphertext` and nothing else about the content.    |
| `message_attachments`      | An encrypted file in the object store. Size and key only.        |
| `message_reactions`        | One tapback per user per message. Encrypted.                     |
| `thread_reads`             | Per-user read state for one thread.                              |
| `history_restore_requests` | A partner asking to have the history re-encrypted.               |

Every foreign key cascades. Deleting a partnership takes its threads, messages,
attachments rows, reactions and read state with it — but **not** the objects in
the media store, which nothing cascades into. See "Media" below.

### Three decisions worth the argument

**`icon` is plaintext, from a closed list of sixteen.** The board is the screen
you look at to decide what to open, so it has to render before any key is
unlocked; encrypting it would leave a page of grey squares until a password was
typed. What it leaks is about four bits from a fixed list, next to timestamps,
sender ids, read receipts and exact ciphertext byte sizes that the server cannot
avoid knowing anyway.

The closed list is the load-bearing part. A free-text plaintext column reachable
from the network would be a covert channel for arbitrary prose, so `isThreadIcon`
is checked in `server/messaging.ts` as well as in the endpoint's Zod schema —
AGENTS.md invariant 13.

**Reactions are encrypted.** The deliberate contrast with the icon, and what
makes both calls defensible: a reaction only ever renders inside a thread that
is already unlocked, so encrypting it costs nothing at all.

**Ciphertext columns are base64 `text`, not `blob`.** SvelteKit serialises load
data with devalue, which cannot carry a `Uint8Array`, so a blob column would
need base64 at the boundary regardless; and `text` round-trips identically
through libsql (dev and tests) and D1 (production), which a blob does not. The
33% overhead applies only to message bodies — attachments are raw bytes in the
object store, where it would have mattered. D1's per-value ceiling is 2,000,000
bytes and `MAX_CIPHERTEXT_BYTES` caps a body at 64 KB.

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

Unread first, newest at the top. Then a divider. Then the read ones, most
recently opened first.

One SQL statement for both halves: `desc(unread)`, then a `CASE` picking
`last_message_at` for the unread half and `last_opened_at` for the read half,
then `id` purely as a tiebreak for two rows inside the same millisecond.

Note where a thread you wrote yourself lands. Posting marks it read _at the time
of posting_, so it sits in the read half ordered by when you wrote it — below
anything you have opened since. That is intended: the read half is ordered by
when you last looked at a thread, and writing in it is the last time you looked.

**In `listBoard`, the `thread_reads` user predicate belongs in the join's `ON`,
not the `WHERE`.** In the `WHERE` it silently turns the left join into an inner
one, and every thread the viewer has never opened disappears from their own
board — which is exactly the threads the feature exists to surface. There is a
test for it.

## Stickers

Each thread's position and tilt come from an FNV-1a hash of its **id**, in
`src/lib/sticker.ts` — not `Math.random`, and not its index in the list. The id
is what makes the board look identical on every reload, on both people's
phones, and after a new thread arrives and pushes the others down; an
index-derived layout would reshuffle every sticker every time anyone sent
anything.

The offset is bounded at ±12% of the sticker's own size and the tilt at ±9°, and
the sticker lives in a CSS grid cell. That bound is what makes the layout safe:
free absolute positioning from a hash could not promise non-overlap, could not
express the board's ordering, and could not reflow onto a narrow phone.

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
4. On confirm, the partner's device decrypts every message body with its own
   identity, re-encrypts to both recipients, and uploads the replacements.

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
- How many attachments each message has, and **each one's exact byte size** — so
  approximate media sizes.
- When each side opened each thread, and when they last read it.
- Which of the sixteen stickers was chosen.

What it does not know: any message text, any filename, any file type, any
reaction, and anything that would let it read or forge any of them.

## Screens and endpoints

| Route                               | What                                              |
| ----------------------------------- | ------------------------------------------------- |
| `/partner/[id]/messages`            | The board. SSRs fully — the icons are plaintext.  |
| `/partner/[id]/messages/[threadId]` | One thread. Its load also records the open.       |
| `/home`                             | A link per partner with something waiting.        |
| `api/partnerships/[id]/threads`     | `POST` multipart: a thread and its first message. |
| `.../threads/[threadId]/messages`   | `POST` multipart: a reply.                        |
| `.../messages/[messageId]/reaction` | `PUT` / `DELETE`.                                 |
| `.../attachments/[attachmentId]`    | `GET`, streams ciphertext.                        |
| `.../ack-warning`                   | `POST`, the one-time warning acknowledgement.     |

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

## Not built yet

The honest boundary:

- **Trust on first use.** The safety number and the pin state machine are
  implemented and tested, but nothing renders or pins one, so a substituted
  partner key would not be noticed. The board does surface an open restore
  request and tells both sides to compare a number — with nothing yet to
  compare it against.
- **Partner-assisted restore.** The data layer, the request table and the
  endpoints' server functions exist and are tested; there is no UI to run the
  re-encryption, so a restore request can be raised but not acted on.
- **Realtime.** `listBoard` and `getThread` are plain loads, and the loads
  declare `depends()` keys (`messages:board:<id>`, `messages:thread:<id>`,
  `messages:unread`) so a sender refreshes its own view — but the _other_ side
  only sees a new message on their next navigation. No Durable Object, no SSE,
  and no polling yet.
- **Video** is accepted and capped, but has had no real exercise beyond a unit
  test of the encryption; only a small PNG is covered end to end.
