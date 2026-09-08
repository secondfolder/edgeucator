# End-to-end encrypted partner messaging

_Implemented 2026-09-07 to 2026-09-08. A frozen record of what was intended at
that moment — do not cite it as current behaviour, and do not update it as the
code moves on. For current behaviour see [docs/messaging.md](../messaging.md)
and [docs/encryption.md](../encryption.md)._

## Context

Partners can link accounts today ([docs/partners.md](docs/partners.md)) but the
partner page says "Shared guides and progress are not built yet." This adds the
first real thing two linked people can do together: send each other short,
self-contained encrypted messages.

The shape is deliberately not a chat log. The couple already has a primary
channel; this is for when one of them is horny and wants to write a sext. So the
unit is a **thread** — a small exchange with a few replies — and next time they
start a new one. A partner's messaging page is a scattered board of sticker-like
icons, one per thread, unread first.

The server stores a copy of everything so that logging in on a new device
restores the history, but it stores **ciphertext only**. It cannot read a message
and cannot derive a key that would let it.

Three properties drive most of the design:

1. **The server never sees the password.** Login and signup derive a value in the
   browser and post that instead, so the password that protects the message
   history never crosses the wire. This is the Bitwarden model.
2. **History survives a new device** — which rules out forward secrecy. Each user
   has one long-term key, and every message is encrypted to both partners.
3. **A forgotten password is recoverable from the partner**, not from the server.
   Both people can already decrypt the whole shared history, so the surviving
   partner re-encrypts it to the other's new key.

---

## Cryptography

### Libraries — no hand-rolled primitives, and no hand-rolled protocol

| Concern | Choice | Why |
| --- | --- | --- |
| Message + attachment encryption | **`age-encryption` (typage) 0.3.1** | A specified file format with multi-recipient support, so "encrypt to both partners" is a library call, not a protocol I design. BSD-3, 93 KB, deps only `@noble/*` + `@scure/base`. Streaming via `ReadableStream` for attachments. |
| Password KDF | **WebCrypto PBKDF2-SHA256, 650k iterations** | Native, so it is fast enough to run at every login. OWASP's current figure and Bitwarden's default. |
| Domain separation | **WebCrypto HKDF-SHA256** | One master key → an auth secret and a wrap key, separated by a one-way step. |
| Wrapping the identity | **WebCrypto AES-256-GCM** | One `encrypt`/`decrypt` call each way. age's own symmetric mode runs scrypt, which would be a redundant second KDF over a key we already have. |
| Passphrase generation | **Vendored EFF long wordlist + rejection sampling** | See below. |

`age-encryption` is only ever `await import()`ed, and only from
`src/lib/crypto/identity.ts` — it pulls `@noble/post-quantum` for a feature we
never use, and the login page must not pay for it.

### On the passphrase generator

There is no maintained library. `eff-diceware-passphrase` is node-only and last
published 6 years ago; the browser generators found are all sites, not packages.
`@scure/bip39` is audited and would avoid vendoring, but its 2048-word list is
seed-phrase-shaped and its API only emits 12/15/18/21/24-word mnemonics — far too
long to type at every login.

So: vendor the **EFF long wordlist** (7776 words, CC-BY 3.0 US) as
`src/lib/passphrase/eff-long.ts`, dynamically imported only on the generator
screen, and select words with `crypto.getRandomValues` plus rejection sampling.
Five words is ~64.6 bits (`vocalist-hazy-radar-plunge-cobweb`). Word *selection*
is not cryptography — the CSPRNG is the platform's — and the one real pitfall,
modulo bias, is five lines of rejection sampling with a unit test that proves it.
Note `@scure/bip39` in the doc as the alternative if vendoring a list is
unwelcome.

### Key derivation

```
masterKey  = PBKDF2-SHA256(password, "edgeucator-mk-v1|" + normalisedEmail, 650_000, 256 bits)
authSecret = HKDF-SHA256(masterKey, info "edgeucator-auth-v1") → base64url, 43 chars
wrapKey    = HKDF-SHA256(masterKey, info "edgeucator-wrap-v1") → non-extractable AES-256-GCM key
```

`authSecret` is posted to better-auth **as the `password` field**, where its
default scrypt (`N=16384, r=16, p=1`, random 16-byte per-user salt — verified in
`@better-auth/utils/password`) hashes it again. That is what stops a stolen
database from being a login verifier.

`wrapKey` never exists as bytes: `deriveKey` produces it directly as a
non-extractable `CryptoKey`.

**Normalisation is `trim()` + `toLowerCase()`, defined once in
`src/lib/encryption.ts`, tested, and never touched again.** Getting it wrong on
any path locks an account out of its own history.

**KDF parameters cannot be per-user.** Login must derive before it can ask the
server anything, so a "what are this email's KDF params" endpoint would be an
account-existence oracle — the hole in Bitwarden's `/accounts/prelogin`. Instead
ship `MASTER_KEY_VERSIONS` as a newest-first ladder from day one: login derives
against the newest, and only on a 401 retries older ones. That is what makes a
future move to Argon2id a client-only change. Do not skip it; retrofitting it
needs the oracle.

### Identity and wrapping

Each user has one long-term age identity, generated in the browser.

- `user_keys.recipient` — the public `age1…`, stored in the clear.
- `user_key_wraps` — one row per unlock method: `(type, params, blob)`, all
  opaque to the server. `blob` is base64url of `IV ‖ AES-256-GCM(identity) ‖ tag`,
  with AAD `"edgeucator-wrap-v1|" + recipient`.

Two wrap types ship: `type: 'password'` and `type: 'webauthn-prf'`.

The table is multi-row for three reasons: a password change inserts the new wrap
**before** changing the password, so a crash mid-change leaves two wraps of which
exactly one works rather than none; a user may hold both a password wrap and one
PRF wrap per passkey; and a future wrap type is then a client-only addition.

### Passkey unlock via the WebAuthn PRF extension

One Touch ID at login both authenticates **and** unlocks messaging. Three facts
make this work, all verified against the installed packages:

- **`@better-auth/passkey` passes WebAuthn extensions through** — server-side via
  `registration.extensions` / `authentication.extensions`, and per-call via the
  client's `opts.extensions`, which it merges over the server's.
- **It already strips the PRF output before posting to the server.**
  `client.mjs` does `const { clientExtensionResults, ...responseBody } = res` and
  posts only `responseBody`; with `returnWebAuthnResponse: true` it returns
  `clientExtensionResults` to the *browser* caller. So the derived secret
  provably never reaches the server, with no workaround needed.
- **SimpleWebAuthn spreads `extensions` through untouched** to
  `navigator.credentials.get()` — it converts only `challenge` and
  `allowCredentials`. So the PRF salt must be a real `Uint8Array` passed via the
  **client-side** `opts.extensions`. Configuring it server-side would JSON-encode
  it and arrive as a useless string. That is a silent failure, so it needs a
  comment at the site.

```
prfOutput = clientExtensionResults.prf.results.first   // ArrayBuffer, browser only
wrapKey   = HKDF-SHA256(prfOutput, info "edgeucator-wrap-prf-v1")
```

`wrap.ts` is unchanged: a PRF wrap is the same AES-GCM blob under a wrap key from
a different source, so there is exactly one wrap format to test.

Deliberately **not** typage's own `age.webauthn` recipient: it runs its own
`navigator.credentials.get()`, which would mean a second Touch ID prompt.
Deriving from better-auth's login assertion keeps it to one gesture.

Four constraints, each of which needs handling rather than hoping:

1. **PRF must be requested at credential creation** — Yubico: *"you must first
   signal your intent during the registration ceremony."* So set
   `registration: { extensions: { prf: {} } }` in `auth.ts`, and accept that
   **passkeys registered before this change cannot be upgraded.** The settings
   screen says so and offers to register a fresh one.
2. **`enabled` is only reported at `create()`**, so check
   `clientExtensionResults.prf.enabled` at registration and record it. Discovering
   the failure at unlock time, on a new device, with no password to hand, is the
   worst possible moment.
3. **`eval` vs `evalByCredential`.** Per spec, `prf.eval` is only valid when
   `allowCredentials` has at most one entry. better-auth omits `allowCredentials`
   for a sign-in with no session (discoverable flow) — so `eval` is right there —
   but populates it with *every* passkey when a session exists, which is the
   unlock-while-signed-in case. That path must use `evalByCredential`.
4. **iOS/iPadOS cannot pass PRF to an external authenticator**, so a security key
   on an iPhone will not work. Platform passkeys (Face/Touch ID, macOS 15+) do.

The password wrap therefore stays the baseline rather than being replaced, and
this needs no schema change — it is what the multi-row table was for.

### The unlocked identity, on the device

Cache it in IndexedDB as a **non-extractable `CryptoKey`** (X25519,
`deriveBits`), which is structured-cloneable, so no code path anywhere can turn
it back into bytes. typage accepts a `CryptoKey` identity directly — verified in
its `x25519.ts`, and `importIdentityKey` reuses its PKCS#8 prefix trick
(`302e020100300506032b656e04220420` + the 32-byte scalar).

Two fallbacks, both needed and both **probed, never assumed**:

- **No WebCrypto X25519** — typage throws for `CryptoKey` identities (it does not
  fall back), and support is not cheaply detectable (Bun implements `importKey`
  but not `deriveBits`). So run a real generate-and-derive probe, memoised. On
  failure, hold the identity string in memory only and never persist it.
- **IndexedDB refuses to clone a `CryptoKey`** (some WebKit builds, Safari
  private browsing) — write and read back once, and downgrade permanently to the
  memory backend on failure.

Treat eviction as normal, not an error: iOS drops IndexedDB after ~7 days idle.
The unlock prompt is a designed screen, not an error state.

### Trust on first use

The server hands you your partner's recipient, so it could substitute its own.
Mitigation:

- A **safety number**: first 80 bits of `SHA-256("edgeucator-safety-v1\n" + the
  two recipients, sorted)`, as Crockford base32 in groups of four
  (`K3JQ-8T2M-9WPX-A4RN`). Sorted so both people derive the same string; Crockford
  because it has no I/L/O/U to misread aloud.
- **Pin the partner's recipient locally on first sight**, in IndexedDB. Never
  re-pin silently. On mismatch, block sending and show a red callout until the
  user explicitly accepts.
- **Pin your own recipient too**, so a server that swaps it is a loud error
  rather than silently-undecryptable mail.
- Say in the banner that already-received messages stay readable — you decrypt
  with *your* key, not theirs — or "key changed" reads as "history lost".

Blocking is client-side only, necessarily: the server is the adversary here and
cannot be asked to enforce a warning about itself. That distinction needs
writing down so the next reader does not file it as an invariant-13 violation.

Pins are per-device until a phase-2 `user_keys.sealed_pins` column (the pin list,
age-encrypted to your own recipient). Until then, show "first seen on this device
just now" so a re-pin is not indistinguishable from a long-standing one.

---

## Recovery

### Password change (you know the current one)

`/settings/encryption`, client-side sequence:

1. Derive old and new master keys, auth secrets and wrap keys.
2. Unwrap the identity with the old wrap key. **Fail here if it does not
   unwrap** — a local "wrong password" check with no server round trip.
3. Re-wrap under the new wrap key.
4. POST `{ currentAuthSecret, newAuthSecret, newWrapParams, newWrapBlob }`.

Server: insert the new wrap → `auth.api.changePassword` → delete the other
password wraps. In that order, for the crash-safety reason above. Pass
`revokeOtherSessions: false`: revoking a session does not revoke a key another
device already holds, and a half-revoked fleet is a worse story than an honest
one.

### Forgotten password → partner-assisted history restore

This is the flow the plan is built around, and it has a hard prerequisite worth
stating plainly: **it restores message history, not account access.** With no
password, no passkey and no email reset flow, there is no way back into the
account at all. So the messaging onboarding actively prompts the user to
register a passkey, and the doc says why.

A PRF-capable passkey changes the ordering here: if one synced, the identity is
recoverable from the passkey alone and none of the below is needed. Partner-
assisted restore is the fallback for when there is no usable passkey wrap.

Given a passkey session:

1. **`/settings/encryption` → "I've forgotten my password".** A server action
   nulls `account.password` for the credential account, then calls
   `auth.api.setPassword` with the new auth secret. The null step is required:
   `setPassword` throws `PASSWORD_ALREADY_SET` when a password exists (verified,
   `update-user.mjs:195-235`). Comment it, because it reaches past better-auth's
   own API into a table whose *schema* file is generated.
2. The browser generates a **new age identity**, wraps it under the new password,
   and replaces `user_keys.recipient` + the wrap rows. The old identity is gone;
   every existing message is unreadable to this user.
3. For each accepted partnership, the client opens a **restore request** carrying
   a snapshot of the new recipient.
4. The partner sees a prompt on that partner's messaging board: *"Ada lost her
   key. Compare this safety number with her before you restore — if it does not
   match, someone else is asking."* This doubles as the TOFU key-change
   acceptance step, and the out-of-band check is **load-bearing**: without it a
   malicious server could inject a request carrying its own recipient and have
   the partner re-encrypt the entire history to it. The UI must be blunt about
   this, and the request must be confirmed against the **snapshotted** recipient,
   not whatever `user_keys` says at upload time.
5. On confirm, the partner's device pages through every message and reaction
   ciphertext in that partnership, decrypts with its own identity, re-encrypts to
   `{partner, requester's new recipient}`, and PUTs them back.

**Attachments are never touched**, and this is why the attachment design differs
from the obvious one: each file is encrypted under its **own ephemeral age
identity**, and that identity travels inside the encrypted message body. So
re-encrypting bodies (kilobytes) restores access to the 25 MB videos in R2 for
free. Encrypting attachments directly to the two partners would have made
recovery mean re-uploading everything.

Honest caveats for the doc: a restore lets your partner rewrite the shared
history (they could already send anything, so this is not a new trust boundary
between the two of them, but it is worth saying); and if both partners lose their
passwords, or a user has no partner, the history is gone.

---

## Data model

Appended to [src/lib/server/db/schema/app.ts](src/lib/server/db/schema/app.ts),
reusing its `timestamps` helper, text-UUID PKs via
`$defaultFn(() => crypto.randomUUID())`, and an index per query path.

| Table | Notes |
| --- | --- |
| `user_keys` | `user_id` unique, `recipient`, `history_warning_ack_at` (nullable — the onboarding checkbox). |
| `user_key_wraps` | `user_id` (indexed), `type`, `params` (JSON), `blob`, `last_used_at`, `label`. **No unique index on `(user_id, type)`** — two password wraps coexisting during a change is deliberate. |
| `message_threads` | `partnership_id` FK cascade, `icon`, and two denormalised columns `last_message_at` + `last_message_sender_id`. |
| `messages` | `thread_id` FK cascade, `sender_id`, `ciphertext`. |
| `message_attachments` | `message_id` FK cascade, `byte_size`, `storage_key`. **No filename and no mime type** — both live inside the encrypted body, so the server learns only that a file exists and how big it is. |
| `message_reactions` | unique `(message_id, user_id)`, `ciphertext`. |
| `thread_reads` | unique `(thread_id, user_id)`, `last_opened_at`, `last_read_message_at`. `created_at` from the helper *is* "first opened". |
| `history_restore_requests` | `partnership_id`, `requester_id`, `requested_recipient` (the snapshot), `status`, `resolved_at`. |

Three decisions worth the argument:

**`icon` is plaintext, from a closed enum.** The board is the screen you look at
to decide what to open, and requirements 3 and 4 are about what it looks like
*before* you open anything — so it has to render without a key. What leaks is ~4
bits from a fixed list, alongside timestamps, sender ids, read receipts and exact
ciphertext byte sizes the server cannot avoid knowing. The enum is the
load-bearing part: a free-text plaintext column here would be a covert channel
for arbitrary prose, so `THREAD_ICONS` is validated by the endpoint's Zod schema
*and* independently in `messaging.ts` (invariant 13).

**Reactions are encrypted.** The deliberate contrast, and what makes both calls
defensible: a reaction only renders inside an already-unlocked thread, so
encrypting it costs nothing.

**Ciphertext columns are base64 `text`, not `blob`.** devalue (SvelteKit's load
serialiser) cannot carry a `Uint8Array`, so a blob column needs base64 at the
boundary anyway; and text round-trips identically through libsql (dev, tests) and
D1 (production). The 33% overhead applies only to bodies — attachments are raw
bytes in R2, where it would have mattered. D1's per-value ceiling is 2,000,000
bytes; cap ciphertext at 64 KB.

### "Unread", exactly once

```
unread(T, V)  ⟺  T.last_message_sender_id <> V
              AND (no read row OR T.last_message_at > R.last_read_message_at)
```

Two thread columns plus a left join. `messages` is never read to draw the board.

This rests on one server-enforced invariant: **you cannot post without being
recorded as having read**, because `sendMessage` upserts the sender's
`thread_reads` row in the same `db.batch()`. Enforced in the server module, not
by "the composer is only reachable from an opened thread".

The board is one query, both groups, correctly ordered — `desc(unread)`, then a
`CASE` selecting `last_message_at` for the unread half and `last_opened_at` for
the read half, then `id` as a tiebreak. **Put `user_id` in the left join's `ON`,
not the `WHERE`**, or it degenerates into an inner join and every never-opened
thread vanishes. That is the most likely bug in this query.

`db.batch()`, never `db.transaction()` (invariant 3). Build the array
tuple-first so TypeScript needs no cast. **R2 objects are written before the
batch**: a crash then leaves an orphaned unreadable blob rather than a row
pointing at nothing.

---

## Module layout

```
src/lib/
  encryption.ts              PURE, ALIAS-FREE. Types, constants, normalisation,
                             safety-number string logic, pin state machine.
                             schema/app.ts imports from it by relative path
                             (invariant 1), as partnership.ts already is.
  messaging.ts               PURE, ALIAS-FREE. THREAD_ICONS, caps, isUnreadFor,
                             compareBoardThreads.
  password-strength.ts       PURE. Strength scoring for the meter.
  sticker.ts                 PURE. The deterministic jitter.
  scroll-parent.ts           EXTRACTED from Task.svelte — ThreadView needs the
                             identical thing, and two copies would drift.
  passphrase/
    eff-long.ts              The vendored wordlist. Dynamically imported.
    generate.ts              Rejection-sampled selection.
  crypto/                    BROWSER ONLY — a new import boundary.
    kdf.ts                   WebCrypto only, zero deps, so login pulls in no age.
    wrap.ts                  AES-GCM wrap/unwrap of the identity.
    identity.ts              typage, via await import().
    fingerprint.ts           SHA-256 half of the safety number.
    keystore.ts              IndexedDB + memory backends, both probed.
    session.svelte.ts        Runtime $state, the wrap-key stash, unlock(), lock().
  messaging/
    client.ts               Encrypt/decrypt seam, multipart building, client caps.
    live.ts                 EventSource client + polling fallback.
  server/
    keys.ts                 All key-table access. Opaque blobs in and out.
    messaging.ts            All messaging queries. Styled on partnerships.ts.
    media/{index,r2,local,platform,dev}.ts       MediaStore switch
    realtime/{index,local,dev,durable-object,binding}.ts   Notifier switch
```

**New invariant for AGENTS.md:** nothing under `src/lib/crypto/` may be imported
from `src/lib/server/**` or any `+*.server.ts`. Every function there touches
`crypto.subtle`, `indexedDB` or typage. The server's entire involvement is
storing and returning opaque strings.

**Second new alias-free zone:** `worker.ts` and
`src/lib/server/realtime/durable-object.ts` are bundled by wrangler's esbuild,
which resolves neither `$lib` nor SvelteKit's aliases.

### `MediaStore` and `Notifier` mirror `db/dev.ts`

Invariant 4 is the constraint that shapes both: `svelte.config.js` strips the
adapter's `emulate` hook, so **`vite dev` has no `event.platform` at all** — no
R2 binding and no DO binding. So each gets the same dev/prod switch behind one
type that [src/lib/server/db/dev.ts](src/lib/server/db/dev.ts) already
establishes:

- `MediaStore` — R2 in production, a `node:fs` directory (`./local-media`) in dev.
  The local one must validate keys against `/^[A-Za-z0-9/_-]+$/`: a `..` in a key
  is nothing to R2 and a path traversal to `node:fs`. That is the one place the
  two are not equivalent and it needs the comment.
- `Notifier` — a Durable Object in production, a module-level `Map` in dev (one
  Node process, so genuinely correct, dead-code-eliminated from the worker
  bundle).

Neither goes on `locals`: three handlers out of ~35 need them, and `locals` is
built for every request.

---

## Routes

### Pages

| File | Notes |
| --- | --- |
| `.../partner/[id]/messages/+page.server.ts` / `.svelte` | The board. `requireMembership` → 404. Fully SSRs (plaintext icons). |
| `.../partner/[id]/messages/[threadId]/+page.server.ts` / `.svelte` | The thread. The load **writes** — `markThreadOpened` — which needs its comment: opening *is* the read event and there is no gesture to hang an action on. |
| `.../home/+page.server.ts` | **New.** `await parent()` for the partner list, then `listUnreadCounts` — no second partnerships query. |
| `.../settings/encryption/+page.server.ts` / `.svelte` | Status, setup, change password, forgotten-password reset, lock now. |

Reads go through `load`, not JSON endpoints — which halves the API surface and
makes realtime just `invalidate('messages:board:<id>')`.

**Neither messaging page can SSR its content.** Every bubble body and attachment
renders as a placeholder and is replaced after decryption. Never render
ciphertext as text, even briefly.

**`AppNav.svelte`'s `isPartner` is an exact route-id match**, so the partner tab
goes dark on `/partner/[id]/messages`. It needs the prefix match `isHome` and
`isSettings` already use, plus a test case.

### Endpoints — `src/routes/api/…`, outside both route groups

| File | Methods |
| --- | --- |
| `api/partnerships/[id]/threads/+server.ts` | `POST` multipart — thread + first message |
| `.../threads/[threadId]/messages/+server.ts` | `POST` multipart — reply |
| `.../messages/[messageId]/reaction/+server.ts` | `PUT` / `DELETE` |
| `.../attachments/[attachmentId]/+server.ts` | `GET` — streams ciphertext |
| `.../restore/+server.ts` | `POST` request, `POST` confirm, `PUT` re-encrypted bodies |
| `.../events/+server.ts` | `GET` — SSE |
| `settings/encryption/wraps/+server.ts` | `GET` — the wrap blobs, for unlock |

Outside the groups **on purpose, and this needs an AGENTS.md line** because it
contradicts "the group is the access control": a group guard is a layout load,
and layout loads never run for a `+server.ts` at all. Putting these under
`(auth-required)` would advertise protection that does not exist. So every
handler opens with its own `if (!locals.user) error(401)` plus
`requireMembership`.

The attachment endpoint **re-joins the partnership id from the URL against the
message**. Without that, anyone in *any* partnership could read any attachment by
putting their own id in `[id]` — the confused deputy this feature is most likely
to ship with. It serves `application/octet-stream` + `nosniff` and no
`Content-Disposition`: the real type is inside the ciphertext, and guessing is how
a browser gets talked into sniffing an encrypted blob as HTML. No `Range` support
— age ciphertext is not seekable.

### The convention this feature has to break, honestly

AGENTS.md says forms are server actions + superforms + Zod. Sending a message
cannot be: the body is ciphertext only the browser can produce, and a `<form>`
posting to an action would have to post plaintext. There is also no
progressive-enhancement story to preserve — with JS off there is no key and
nothing to show.

What is kept: **Zod still validates every field**, in
`src/lib/schemas/messageForm.ts`, imported by both the endpoint and the client so
the client refuses before spending a round trip on 25 MB. It validates the
envelope, never the content.

---

## The auth change

The forms stay server actions with superforms, Zod, `setError` and
`redirect(303)`. Three edits each:

1. The password `<input>` **loses its `name`** and moves into a new
   `PasswordField.svelte`. `InputField.svelte` sets `name={field}`
   unconditionally, and a named input is in the FormData whether or not any JS
   runs — one thrown exception away from posting the plaintext.
2. A hidden `<input name="authSecret">`, empty in the HTML.
3. `superForm(data, { onSubmit })` derives and fills it.

superforms' `onSubmit` **is** awaited before `enhance` dispatches, and
`submit.formData` is the object dispatched — verified in
`sveltekit-superforms/dist/client/superForm.js:1206`. That is an implementation
detail, not a documented contract, so it gets a comment naming the file and an
e2e test that fails loudly if it changes.

**Do not add a `validators` option to either form.** Client validation runs
against `$form`, whose `authSecret` is `''` and which has no password field at
all. It would reject every submission. Comment it on both — adding validators is
otherwise an obviously good idea.

`auth.ts` pins `minPasswordLength: 43` / `maxPasswordLength: 43`, which turns a
client bug into a loud 400. Safe because `/sign-in/email` does not length-check
at all (only sign-up, change-password and set-password do).

The no-leak rule is preserved and slightly strengthened: a wrong email now
derives a *different* auth secret, so the 401 is genuinely indistinguishable in
both directions.

**Password strength becomes structurally client-side** — the server sees a valid
43-char base64url for `""` as readily as for a good passphrase. There is no fix
that preserves the design, so it is written down in two places (a comment on the
Zod field and a paragraph in the doc) explicitly distinguishing it from what
invariant 13 forbids. Enable better-auth rate limiting on `/sign-in/email` as the
compensating control.

### JS is now required to sign in — but it already was

A `<noscript>` block on both forms says so before a wasted POST, and the Zod
error on the empty hidden field renders under the password box.

**Corrected during implementation.** This was planned as "a deliberate retreat
from a value AGENTS.md holds". It is not: measured with scripting disabled, the
login form has **zero** usable text inputs, because every field is a
`<wa-input>` custom element whose real `<input>` only exists once Web Awesome
upgrades it. Login and signup already required JavaScript before the KDF
existed, and not because of it. So nothing was given up here, and the
`<noscript>` block is a net improvement: it explains a pre-existing dead end
that previously just looked broken. There is an e2e assertion pinning the
measurement.

### Existing accounts: `npm run db:reset`

The alternative — a `password_kdf_version` column with a legacy path — is
unbuildable without giving back what the change removes. A legacy account's
stored hash is `scrypt(plaintext)`, so the legacy path must post the plaintext;
and deciding *which* path to use means asking the server about an email before
deriving, which is an account-existence oracle. README gets a breaking-change
note. There are no messages to preserve.

---

## UI

New Web Awesome imports in [src/routes/+layout.svelte](src/routes/+layout.svelte)
— without these the elements render as inert unknown tags: `textarea`, `divider`,
`dialog`, `spinner`, `tag`, `callout`, `popover`, `checkbox`, `progress-ring`.

**Invariant 11 applies everywhere here:** `disabled={sending}`, `open={isOpen}` —
never `|| undefined`, which this version coerces to `true` on the property and
which silently broke "Add a passkey".

### The sticker board

The idea that makes requirements 3 and 4 compatible: **jitter inside a CSS grid
cell, never free positioning.** Absolute placement from a hash cannot guarantee
non-overlap, cannot express an order, and cannot reflow to a 320 px phone.

`src/lib/sticker.ts` derives offset and tilt from an FNV-1a hash of the **thread
id** — not `Math.random`, not the index, so the board looks identical on every
reload and on both phones, and a new thread does not reshuffle it. Bounded at
±12% of the sticker's own size and ±9°, which is what guarantees two neighbours
can never overlap illegibly. The three values go out as custom properties, so the
inline `style` carries no user input.

`grid-template-columns: repeat(auto-fill, minmax(5.5rem, 1fr))` — `auto-fill`,
not `auto-fit`, so a 320 px phone settles at three columns with a real tap target
instead of stretching two stickers wide.

Two separate `<ul>`s with a `wa-divider` seam between them, rather than one grid
with a full-width row: both declare the same columns so they stay aligned, and
"unread first" becomes plain document order — which is what a screen reader and a
Playwright locator both want.

`prefers-reduced-motion` drops the hover transition but **keeps the tilt**: it is
a static transform, not motion, and flattening the board would remove the point
of the requirement.

Icons are `wa-icon` with 16 names verified present in the free Font Awesome
classic-solid set bundled with Web Awesome 3.12 — `envelope`,
`envelope-open-text`, `bottle-droplet`, `scroll`, `note-sticky`, `paper-plane`,
`heart`, `fire`, `pepper-hot`, `gem`, `key`, `mask`, `ghost`, `gift`,
`cake-candles`, `feather`. `canvas="square"` so all 16 share a footprint. Worth
knowing: `wa-icon` fetches each SVG at runtime, so a first board paint is up to
16 cross-origin requests — note it, add a `preconnect` if it shows, don't
pre-optimise.

The icon picker is a 4×4 grid of **native radios** with `wa-icon` labels,
following `PartnerFields.svelte`, which already states the reason and which is why
the e2e helpers can drive it directly.

### The thread view

Three shell constraints from AGENTS.md apply verbatim:

- `position: fixed`/`sticky` against the viewport does not work — but
  `position: sticky; bottom: 0` *inside* `<main>` pins to the bottom of the
  scrollport, directly above `AppNav`, which is exactly where the composer wants
  to be. `Task.svelte`'s footer is the working precedent, gradient fade included.
- `window.scrollTo` moves nothing. Scroll-to-newest goes through the extracted
  `scrollParentOf`, with `Task.svelte`'s tick-then-check-you-are-still-current
  guard, or a burst of arriving messages queues stale scrolls.
- `min-height: 100%` needs a specified-height ancestor; stretch with
  `flex: 1 1 auto`.

`wa-textarea resize="auto" rows="1"`; Enter inserts a newline and the button
sends, because a sext is multi-line prose more often than a chat line.

Attachments: `AttachmentPreview` renders a decrypted `blob:` URL and revokes it on
destroy. A video is fully downloaded and decrypted before it plays, which is why
`MAX_VIDEO_BYTES` (15 MB) is below the 25 MB message total. `fetch` exposes no
upload progress, so the composer shows a spinner; `XMLHttpRequest` is the noted
follow-up if that is not enough.

**Two links must not share an accessible name** — it is a real a11y problem and it
makes a locator ambiguous, which is how the existing one was noticed. So:
`/home` → "3 new messages from Jun"; `AppNav` tab → "Jun"; board button → "Write
something"; partner page → "Messages"; stickers → "Unread message 1 of 3, 2
minutes ago" (position included, since two can share a timestamp).

### Onboarding copy

- **Signup** — a short, calm line under the password field: this password also
  encrypts your messages, so make it strong and write it down. Not scary, not
  prominent.
- **First visit to any messaging page** — a blocking interstitial, before the
  board: if you lose this password your message history is lost, write it down.
  A `wa-checkbox` to confirm, which sets `user_keys.history_warning_ack_at`. Also
  the natural place to prompt for a passkey, since without one a forgotten
  password means no account access at all and partner-assisted restore cannot
  even begin.
- **A user with no password credential** — explain the E2E section, then: a
  password is needed to enable messages, and it is *not* needed to log in
  normally, only to log in on a new device for the first time. With the
  passphrase generator, a write-it-down instruction and a confirm checkbox.
  Today every account has a password so this state is unreachable, but it is the
  path a passkey-first signup would land on.

---

## Realtime

**SSE, not WebSocket**, for a decisive reason: `vite dev` cannot serve a
WebSocket upgrade from a `+server.ts` at all, so a socket would need a second
client code path for development — and the Playwright suite would never exercise
the real one. An SSE stream is a plain streaming `Response` and behaves
identically in dev and on Workers.

**Events are metadata-only, and that is a rule.** An event carries `{ kind,
threadId }` and nothing else; the client's whole reaction is `invalidate()`. So
the Durable Object never handles message content, holds no storage, and knows
nothing but a partnership id.

**The client hangs up when the page is hidden.** This is not an optimisation. A
DO is billed 128 MB × wall-clock while it holds an in-flight request, and only
hibernation-eligible idleness is free — hibernation needs the WebSocket
Hibernation API, which SSE cannot use. One permanently-open stream is 10,800
GB-s/day, **83% of the Free plan's 13,000 GB-s daily allowance for a single
partnership**. Closing on `visibilitychange` turns that into "billed while
someone is looking". On becoming visible, reconnect *and* `invalidate()` once
unconditionally — anything that happened while hung up was never delivered, and
that step is what makes hanging up safe.

`EventSource` retries on its own but too eagerly; `onerror` closes and reschedules
at `min(1000 * 2 ** attempt, 30_000)` with ±20% jitter, reset on the first
message.

### The custom worker entry — the trap here is real

**Do not point `main` at a custom entry.** `adapter-cloudflare` treats `main` as
its *output* path and `rimraf`s it before writing (verified,
`@sveltejs/adapter-cloudflare/index.js:52-56`), so `main: "worker.ts"` makes
`npm run build` delete your file.

Instead `main` stays on the adapter's default and wrangler takes the entry as a
positional argument:

```jsonc
"preview:worker": "npm run build && npm run db:migrate:d1 && wrangler dev worker.ts",
"deploy": "npm run build && wrangler deploy worker.ts",
```

`worker.ts` lives at the repo root — not under `src/`, so `svelte-check` does not
try to resolve a build artefact that only exists after a build — and does nothing
but re-export the generated worker plus the DO class.

`wrangler.jsonc` gains the R2 bucket, the DO binding, and a top-level
`migrations` array. That last one needs a comment saying it has **nothing** to do
with `d1_databases[0].migrations_dir` above it: one is SQL, the other is Durable
Object class lifecycle, and `npm run db:migrate:*` does not touch it.

The DO is written in the classic `(state, env)` + `fetch` style specifically to
avoid `import { DurableObject } from 'cloudflare:workers'`, which has no types
without `@cloudflare/workers-types` — a package AGENTS.md forbids because its
ambient globals would overwrite the DOM's `Request`/`Response` project-wide.

---

## Sequencing

Each stage is independently shippable and green, and defers exactly one risky
dependency.

| # | Content | Needs |
| --- | --- | --- |
| **0** | `encryption.ts`, `messaging.ts`, `password-strength.ts`, `sticker.ts`, `passphrase/*`, `crypto/{kdf,wrap,identity,fingerprint}.ts` + all their node tests. Nothing wired up. | nothing |
| **1** | The seven tables → `db:generate` → **read** `drizzle/0003_*.sql` → `db:migrate` → commit. `server/keys.ts`, `server/messaging.ts`, testing fixtures + in-memory `MediaStore`. Server tests. | nothing |
| **2** | The auth change: `PasswordField`, the schemas, both forms, both actions, `auth.ts` min/max, the `e2e/helpers.ts` repair, the README breaking-change note. **Auth now uses the new scheme and every account stores a recipient and wrap, but nothing yet depends on unwrapping** — the riskiest stage, deliberately shippable alone. | nothing |
| **3** | `keystore.ts`, `session.svelte.ts`, `EncryptionGate`, `UnlockForm`, `/settings/encryption` (status, change password, forgotten-password reset, lock now), logout clears. **Plus the PRF wrap**: `registration.extensions.prf` in `auth.ts`, `crypto/prf.ts`, the PRF wrap type, passkey-unlock-at-login, and the settings copy about pre-existing passkeys. | stage 2 |
| **4** | Text threads end to end with **real** encryption: both pages, `StickerBoard`, `ThreadSticker`, `ThreadIconPicker`, `MessageComposer`, `MessageBubble`, `ThreadView`, `scroll-parent.ts` extracted, the `threads`/`messages` endpoints, `/home` unread links, the Messages button, the `AppNav` prefix fix, the onboarding interstitial. `live.ts` ships as a visibility-gated `invalidate()` poller. | stage 3 |
| **5** | Reactions. TOFU: `SafetyNumber`, pins, the changed-key banner. | stage 4 |
| **6** | Attachments: `server/media/*`, the R2 bucket, multipart on both POSTs, the download endpoint, `AttachmentPreview`, `local-media/` in `.gitignore` and `db:reset`, purge on disconnect. First stage needing `preview:worker` before deploy. | a Cloudflare bucket |
| **7** | Partner-assisted restore: the requests table, both endpoints, the re-encryption client, the confirm UI. | stages 5, 6 |
| **8** | Realtime: `realtime/*`, `worker.ts`, the wrangler entries, the SSE endpoint, `live.ts` swapped to `EventSource` **keeping the poller as the fallback**. | the build change |
| **9** | Docs. | everything |

Note there is deliberately **no stage that ships a stubbed crypto seam**. An
intermediate state that stores base64-of-plaintext in a column called
`ciphertext` is one forgotten follow-up away from being the shipped behaviour.

---

## Documentation (part of the change, not a follow-up)

- **`docs/encryption.md`** (new, + its row in the AGENTS.md table) — key
  derivation, the wrap model, TOFU, recovery, and a first paragraph that does
  **not** overstate the guarantee: the server ships the JavaScript that runs the
  KDF, so "the server never sees your password" is an operational property, not a
  cryptographic one. What it genuinely buys is no plaintext in request logs, error
  reports or a leaked capture, and no credential-stuffing value from any of them.
  Say so, or a future reader removes a defence because "we're E2EE anyway".
- **`docs/messaging.md`** (new, + its row) — the data model, the unread
  definition, the ordering, the plaintext-icon and encrypted-reaction decisions,
  the dev/prod switches, the endpoint list, and a **"What the server still knows"**
  section: thread count, exact timings, which side sent each message, attachment
  counts, exact ciphertext byte sizes, read receipts, and the chosen sticker.
  Anything less is dishonest given how the feature is framed.
- **`docs/partners.md`** — the Messages button; disconnect now purges media.
- **`README.md`** — the breaking auth change, `wrangler r2 bucket create`,
  `local-media`, and the new `wrangler dev worker.ts` invocation and why.
- **`AGENTS.md`** — the two new invariants (`src/lib/crypto/**` is browser-only;
  `worker.ts` + the DO are a second alias-free zone); the adapter-overwrites-`main`
  trap; `src/routes/api/` being outside both groups and why a group there would be
  decorative; the two unrelated `migrations` in `wrangler.jsonc`; ciphertext
  columns being base64 text; and **the reworded "never log a form object"** — it
  no longer contains a plaintext password but does contain `authSecret`, a
  permanent login credential and just as bad to log. Plus the honest-baseline
  counts and the e2e timing, both of which this change moves.
- **`docs/historical-plans/2026-09-07-messaging.md`** — the frozen record.

---

## Verification

Beyond `npm run check` / `lint` / `test` / `test:e2e` / `format`:

**Pure, node** — this is where nearly all the crypto belongs, and where
`crypto.subtle` actually works.

- **A frozen KDF vector**: `deriveAuthSecret(deriveMasterKey('correct-horse-battery',
  'ada@example.test'))` equals a checked-in 43-char string. This is the single
  most valuable test in the change — it is what stops a refactor from silently
  locking every account out of its own history. Use reduced iterations everywhere
  *except* this test.
- Wrap round trip; wrong key → `null` not a throw; **AAD binding** (a different
  recipient → `null`); a flipped byte → `null`; two wraps of one identity differ;
  malformed base64url *throws*, so "wrong password" and "corrupt data" stay
  distinguishable.
- `recipientFor(cryptoKey) === recipientFor(identityString)` — the test that
  proves typage accepts a `CryptoKey`, and that fails loudly on an upgrade that
  changes it. Plus a full circle: encrypt to both recipients, each decrypts
  independently, a third identity does not.
- Normalisation: `'Ada@Example.TEST '` and `'ada@example.test'` derive
  identically — and Gmail-style dot-stripping is asserted *absent*.
- `sticker.ts`: identical output across calls for one id; within bounds for 2,000
  generated uuids; **both signs occur on each axis** (a hash that only produced
  positive offsets would look wrong and pass a bounds test).
- `isUnreadFor` truth table, including the equal-timestamp boundary that decides
  whether reopening a thread flickers.
- Passphrase selection: uniform within bounds over many samples, i.e. no modulo
  bias.

**Server, in-memory libsql from the committed migrations** — use frozen test
strings from `src/lib/testing/crypto.ts`; never run the real 650k KDF here.

- **Sending marks the sender read** — the invariant the whole unread definition
  rests on, so it gets its own test.
- `listBoard` ordering against a hand-built fixture, then asserted from the
  *other* viewer and yielding a different order. That is the per-viewer flip, and
  the analogue of the existing `viewPartnership` tests.
- `listBoard` returns never-opened threads (the join-predicate bug).
- **404 for a thread id belonging to another partnership**, and for an attachment
  addressed through a partnership the viewer *is* in — the confused deputy.
- Over-cap byte total refused with **zero R2 objects written**; a `put` that
  throws leaves zero rows.
- `user_keys` present with zero wraps must be a **hard error, never a silent
  re-provision** — a server that deletes your wraps must not be able to trick the
  client into generating a fresh identity and orphaning the history.

**Component, jsdom** — jsdom has **no `SubtleCrypto` at all** (only
`getRandomValues` and `randomUUID`), so add Node's `webcrypto` to
`vitest-setup-client.ts` next to the existing `matchMedia` shim. Do not test
crypto through components — jsdom has no `indexedDB` either; inject the memory
backend and a stub unlock function, and assert on emitted attributes, since
`wa-*` never upgrades here.

- A pending decryption renders a placeholder and **never the ciphertext string** —
  grep the rendered HTML for it and assert absence. Cheap, and it catches the
  worst possible bug in the feature.
- `MessageComposer`'s send button carries no `disabled` attribute when idle —
  precisely the invariant-11 regression the passkey button hit.

**End to end** — the suite already drives two browser contexts for two accounts,
which is exactly this feature's shape.

- Sign up, sign out, sign in in a **second context** (a genuinely new device, no
  IndexedDB) and read something only the unlocked identity could produce.
- **The request body never contains the password** — assert the posted FormData
  carries `authSecret` and that no field equals the password. The one assertion
  that catches a regression reintroducing the leak, and the guard on superforms'
  undocumented `onSubmit` behaviour.
- Ada writes a thread; Jun's `/home` shows "1 new message from Ada"; Jun opens it
  and **sees Ada's plaintext** — encrypt → store → load → decrypt, end to end.
- Jun replies and **Ada's open board updates without a reload** (`expect.poll`,
  never `page.reload()`).
- Ordering across the seam; reactions; a small PNG round-tripping to a `blob:`
  URL; a 26 MB file refused **client-side**, asserted by counting that no request
  was made.
- JS disabled → login renders the "JavaScript must be enabled" message and does
  not sign in.

**`npm run preview:worker`** is mandatory from stage 6 on — it is the only thing
that exercises the DO, the R2 binding and the custom entry, and stage 8 changes
the build.

**First thing to verify in stage 8**, before anything else: that
`npm run build && npm run preview:worker` does not delete `worker.ts`.

---

## Noted follow-ups (not in scope)

- **Deliver the inviter's recipient in the invite URL fragment.** The invite link
  already travels out-of-band and `navigator.share()` is already wired up; a
  fragment never reaches the server, so this is genuine out-of-band key delivery
  and removes trust-on-first-use for that direction entirely. The invitee then
  computes the true safety number, and one comparison closes the other direction.
  Cheap, and strictly better than TOFU — but it needs the inviter to hold keys at
  invite-creation time, so it is a change to the partners flow, not this one.
- **Signing the recipient with the passkey** was considered and rejected: the
  verifier fetches the credential's public key from the same server that serves
  the recipient, so a malicious server substitutes both. It relocates the trust
  anchor rather than removing it, at the cost of COSE parsing and ES256/EdDSA
  verification in the browser, for a job the safety number already does.
- **`user_keys.sealed_pins`** — the pin list age-encrypted to your own recipient,
  so pins and verification status survive a new device.
