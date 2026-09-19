# Privacy

Privacy is a product rule in this app, not a soft preference.

## Baseline rule

A user must not be able to read, infer, or probe another user's information
just by knowing or guessing an id, URL, email, or other identifier. Data is
shown only on routes and queries that have already established the viewer is
allowed to see it.

In practice that means:

- Unrelated accounts do not get access to each other's profile details.
- A route that reveals relationship data first proves membership in that
  relationship.
- Public pages show only the minimum information they need.

## Partners are not blanket access

Being linked as partners does not mean "show them everything". A partnership is
permission to reveal only the fields the product has explicitly decided are
shared in that context.

Current examples:

- Partner pages can show counterpart information that is deliberately shared
  through membership-checked partnership reads, such as the partner timezone
  display.
- The public invite page does not reveal an email address, account id, or full
  account profile. It shows only the inviter-chosen name needed to explain the
  invite.
- Other account details stay private unless the product adds an explicit reason
  and a guarded read path to reveal them.

## User choice still matters

Even inside shared surfaces, some information may remain intentionally private
or become selectively shareable later. Future work should preserve that option
instead of treating a partnership as permanent permission to expose every
account attribute.

## Especially sensitive data should be zero-access by default

For particularly sensitive user information — intimate photos are the obvious
example — the product goal is zero-access storage: encrypt it before it leaves
the user's device and keep the server out of the plaintext path.

In other words, this class of data should be treated as end-to-end encrypted in
the product sense: the app stores ciphertext and should have no routine access
to the contents.

When implementing that, be precise about the guarantee and document the exact
boundary the same way [`docs/encryption.md`](encryption.md) does. That document
spells out the difference between "the server stores ciphertext only" and the
stronger guarantees people often assume from the phrase "end-to-end
encrypted".

The messaging feature now has one explicit derived-data exception worth naming:
the browser may send supported URLs from a decrypted message to Bound Up's own
`/api/embed-metadata` endpoint so it can resolve a preview and hand it back for
encryption into the message's metadata sidecar. A reddit URL may also reach the
server through `/api/oembed`, because reddit's oEmbed API is CORS-blocked. That
does widen what the server may transiently receive, but the derived preview is
still stored only as ciphertext in the database.

By default those URL disclosures happen only at send time or when a viewer
presses `Show` for an older embed. After the user explicitly opts into
automatic message-thread embeds, the same URL lookups may happen automatically
for embeds that are in or near the viewport. The consent prompt says that those
lookups are sent to Bound Up's servers and are never logged.

## Design rule for new features

When adding a field or screen, ask two separate questions:

1. Should this viewer be able to reach this data at all?
2. If yes, which exact fields are intentionally shared here?

Do not answer the second question with "all of them" just because the first one
was yes.
