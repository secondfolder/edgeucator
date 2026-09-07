# Partners

Two accounts can link with each other. One person answers a few questions, gets
a link, and sends it out-of-band; the other opens it, signs in if they need to,
confirms, and the two are linked. Each then sees the other as a tab in the
bottom nav.

This document is the current behaviour. For why it was built this way, see
[`docs/historical-plans/2026-09-07-partners.md`](historical-plans/2026-09-07-partners.md) —
a frozen record, not a description of the code as it stands.

## The shape of a link

A link is **one row** in `partnerships`, not one per direction. The two names
and the single control setting belong to the relationship, so storing them twice
would let the two halves disagree.

| Column                               | Meaning                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------- |
| `inviter_id`                         | Who created the invite. Never changes, not even after acceptance.                     |
| `invitee_id`                         | Who accepted it. `NULL` exactly while `status` is `'pending'`.                        |
| `status`                             | `'pending'` or `'accepted'`. There is no declined or ended state — see below.         |
| `inviter_name`                       | The name shown **for the inviter**, i.e. the answer to "what do they call you?".      |
| `invitee_name`                       | The name shown **for the invitee**, i.e. the answer to "what do you call them?".      |
| `relationship_label`                 | An optional shared word for the connection ("partner", "trainer"). `NULL` when unset. |
| `control`                            | `'inviter'`, `'invitee'` or `'both'`. Who may change the three fields above.          |
| `invite_token` / `invite_expires_at` | The secret in the URL and its deadline. Both cleared on acceptance.                   |
| `accepted_at`                        | When the link was made.                                                               |

Both foreign keys cascade on delete, so deleting a user removes every link they
were in — otherwise the other person would keep a nav tab pointing at nothing.

`invite_token` has a unique index. SQLite allows many `NULL`s in a unique index,
so clearing the token on acceptance also frees the inviter to send another
invite later.

### Roles are permanent, and that is deliberate

`inviter` and `invitee` are not just plumbing for the invite. They stay
meaningful for the life of the row, because `control` is expressed in terms of
them. That is what makes a single row readable from both ends: whoever loads it,
`control === 'inviter'` means the same thing.

### Never read the name columns directly

Which of `inviter_name` / `invitee_name` is "theirs" flips with who is looking.
Getting that backwards is the easiest bug in this feature, so exactly one
function does the mapping:

```ts
import { viewPartnership } from '$lib/partnership';

const view = viewPartnership(row, viewerId, counterpart);
view.partnerName; // what the viewer calls the other person
view.yourName; // what the other person calls the viewer
view.role; // 'inviter' | 'invitee'
view.canEdit; // may this viewer change the settings?
```

`viewPartnership` **throws** for a user who is not a member, rather than
returning a half-built view. Every read path in
[`src/lib/server/partnerships.ts`](../src/lib/server/partnerships.ts) goes
through it.

### `id` in a URL is always the partnership id

`/partner/[id]` and `/settings/partners/[id]` are keyed on the partnership, not
on a user. That way a link can be addressed before the second user exists, and
no user id ever appears in a URL.

## The control question

The form asks **"Who's in control?"** with three answers: **Me**, **Them**,
**A mix**. It is always asked from the answerer's own side, and always stored
against the permanent roles. Two pure functions are the only translation:

```ts
controlFromAnswer('me', 'inviter'); // → 'inviter'
controlFromAnswer('me', 'invitee'); // → 'invitee'
controlFromAnswer('mix', anyRole); // → 'both'

answerFromControl('inviter', 'inviter'); // → 'me'
answerFromControl('inviter', 'invitee'); // → 'them'
```

The round trip holds for all six combinations, and there is a test that says so.
The Zod schema accepts only `me` / `them` / `mix` — posting the _stored_ value
`inviter` is rejected, so there is no way to set `control` without going through
`controlFromAnswer`.

### What control gates

| Action                                           | Who may do it                                |
| ------------------------------------------------ | -------------------------------------------- |
| Change the names, the label, the control setting | Whoever `control` names, or both             |
| Rewrite the names while accepting an invite      | The accepter, if control is theirs or shared |
| Disconnect, or cancel a pending invite           | **Either member, always**                    |

Disconnecting is deliberately not gated: a user who handed control to their
partner must still be able to get out. `deletePartnership` checks membership and
nothing else.

### Permissions are enforced on the server

A disabled input is a rendering decision, not a permission. The read-only accept
screen still posts every field as hidden inputs, so that the payload satisfies
the same Zod schema — and `acceptInvite` then re-reads the stored row and
ignores anything submitted by someone who does not hold control, `control`
included. Accepting an invite is never a way to seize control of it.

The edit action does the same: it re-checks `control` against the database
rather than trusting that the page hid the form, because control can have
changed since the page was rendered.

## The invite link

- **Token**: 32 bytes from `crypto.getRandomValues`, unpadded base64url.
  `randomUUID` is not used — it carries only 122 bits and has a recognisable
  shape, and this value is the entire authorisation to join someone's account.
- **Stored in the clear.** Hashing would mean the inviter could never be shown
  the link again, and re-sending an already-created link is a requirement.
  Better Auth stores `session.token` the same way, so this grants an attacker
  with database read access nothing they would not already have.
- **Expires after 7 days** (`INVITE_TTL_MS`).
- **Single use.** Accepting clears the token, so the link cannot be replayed.
- **Renewable.** "Create a new link" rotates the token and extends the window,
  which invalidates the previous link. It is offered rather than done
  automatically on every re-copy, because rotating silently would break a link
  the inviter had already sent.
- **Only ever sent to the inviter**, and only while it is live. The token is
  never included in the page data of anyone who could not already use it.

Two accepts racing on the same link cannot both win: the token is matched again
inside the `UPDATE`'s `WHERE`, so the first clears it and the second matches no
rows.

`acceptInvite` refuses, with a distinct reason each time: an unknown or consumed
token (`not-found`), an expired one (`expired`), the inviter's own link
(`self`), and a second link between a pair who are already connected
(`already-linked`, checked in both directions).

## Screens

| Route                     | Group             | What it does                                                         |
| ------------------------- | ----------------- | -------------------------------------------------------------------- |
| `/settings/partners`      | `(auth-required)` | Linked partners and outstanding invites. "Add" starts a new one.     |
| `/settings/partners/new`  | `(auth-required)` | The four questions. Creates the pending row and the link.            |
| `/settings/partners/[id]` | `(auth-required)` | Pending: the link, share, renew, cancel. Accepted: edit, disconnect. |
| `/invite/[token]`         | **`(public)`**    | The landing page for the person being invited.                       |
| `/partner/[id]`           | `(auth-required)` | The partner's own page. Accepted links only.                         |

### Why `/invite/[token]` is public

The whole point is that it is opened by someone who may not have an account. The
`(auth-required)` guard would bounce them to `/login` and, since the guard
carries no `redirectTo`, lose the invite entirely. Its load returns one of five
states:

| State              | When                               | What the page shows                                                         |
| ------------------ | ---------------------------------- | --------------------------------------------------------------------------- |
| `invalid`          | Unknown, consumed or expired token | "This link doesn't work". Nothing else — see below.                         |
| `sign-in-required` | Valid token, nobody signed in      | The inviter's chosen name, plus login/signup buttons carrying `redirectTo`. |
| `self`             | The inviter opened their own link  | "That's your own link"                                                      |
| `already-linked`   | The two are already connected      | "You're already linked"                                                     |
| `confirm`          | Otherwise                          | The confirmation form, editable per `control`.                              |

An expired token and an unknown one are reported identically: there is no value
in telling an anonymous visitor which of the two they found. Before sign-in the
page shows the name the inviter chose for themselves and nothing else — no
email, no account name, no user id.

Because actions run **before** layout loads, the group guard never gates an
action. Every action in this feature checks `locals.user` itself; that check is
not redundant.

### Getting back to the invite after signing in

`/login` and `/signup` accept `?redirectTo=`. The value is validated by
`safeRedirect` in [`src/lib/safe-redirect.ts`](../src/lib/safe-redirect.ts) both
on the way in (so a hostile value never renders as a link) and on the way out.
It rejects absolute URLs and protocol-relative ones — `//evil.example` and
`/\evil.example` are both read as off-site by browsers — and falls back to
`/home`.

The passkey sign-in path never touches the server action, so `LoginForm` applies
the same destination itself; otherwise a passkey login would drop the invite.

## The bottom nav

`(auth-required)/(app)/+layout.server.ts` calls `listPartnersForNav`, which
returns one `PartnerView` per **accepted** partnership. Pending invites are
excluded on purpose: until the other person accepts there is nobody behind the
tab, and a tab that opens an empty page reads as a bug. They are visible in
settings instead.

Each tab shows the name _that viewer_ chose and, when the partner has one, their
avatar. `AppNav` decides the active tab from `page.route.id`, never a pathname —
see the note in `AGENTS.md`.

## Sharing the link

[`src/lib/share.ts`](../src/lib/share.ts) does both things at once: it writes the
link to the clipboard **and** opens the platform share sheet if there is one.
Three details are load-bearing:

- The clipboard write is **started but not awaited** before `navigator.share`.
  `navigator.share` needs transient user activation, and awaiting anything first
  consumes it — Safari then rejects the share outright.
- The clipboard write is capped at 2 seconds. When the document is not focused,
  Chromium leaves `writeText`'s promise _pending_ rather than rejecting, and a
  caller waiting on it would hang.
- An `AbortError` from the share sheet means the user dismissed it. That is a
  normal outcome, not a failure: the link is on the clipboard either way, and
  nothing is logged.

After creating an invite the action returns the link via superforms' `message()`
**instead of redirecting**, so the share attempt happens inside the click that
caused it. The page then navigates itself. The share call there is fired and not
awaited: the sheet stays open until the user picks something, and a client-side
navigation does not dismiss a browser-level sheet.

## Files

| Path                                          | What it holds                                         |
| --------------------------------------------- | ----------------------------------------------------- |
| `src/lib/partnership.ts`                      | The domain rules. Pure, alias-free, no database.      |
| `src/lib/server/partnerships.ts`              | Every query and mutation, including the aliased join. |
| `src/lib/schemas/partnerForm.ts`              | The Zod schema shared by add, accept and edit.        |
| `src/lib/components/PartnerFields.svelte`     | The four questions, editable or read-only.            |
| `src/lib/components/PartnerAcceptForm.svelte` | The accept form. Owns its `superForm`.                |
| `src/lib/invite-url.ts`, `src/lib/share.ts`   | Building the URL, and handing it to the platform.     |
| `src/lib/safe-redirect.ts`                    | The `redirectTo` allowlist.                           |
| `src/lib/server/db/schema/app.ts`             | The `partnerships` table.                             |

`partnership.ts` is **alias-free** (relative imports only), like
`src/lib/types.ts`: the Drizzle schema imports its two union types, and
drizzle-kit loads the schema outside Vite where `$lib` does not resolve.

There is no `relations()` for `partnerships`. Two foreign keys point at the same
table, which drizzle's relational query API can only disambiguate with a
`relationName` declared on _both_ sides — and the `user` side lives in the
generated `schema/auth.ts`, where an edit would be lost on the next
`npm run auth:schema`. Reads use explicit aliased joins instead.

## Tests

| Level     | Where                                                                                 | Covers                                                                    |
| --------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Pure      | `src/lib/partnership.test.ts`, `safe-redirect.test.ts`, `schemas/partnerForm.test.ts` | Permission rules, the per-viewer flip, the control round trip, validation |
| Server    | `src/lib/server/partnerships.test.ts` plus a `page.server.test.ts` per route          | Every query and action against a real in-memory SQLite database           |
| Component | `AppNav.svelte.test.ts`, `PartnerAcceptForm.svelte.test.ts`                           | Nav tabs and active state; editable vs read-only fields                   |
| E2E       | `e2e/partners.spec.ts`                                                                | The whole flow in a browser, across two session cookies                   |

`AGENTS.md` has the harness details — how to build a test database, how to fake
a `RequestEvent`, and the Playwright gotchas.

## Not built yet

- No decline action. The accept screen offers "Not now", which just leaves.
- No notification to the inviter when an invite is accepted.
- `/partner/[id]` has no shared content; it names the link and points at its
  settings.
- Permissions cover the names, the label and the control setting. They do not
  gate anything about guides or progress.
