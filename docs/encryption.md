# Encryption keys

Private messages between partners are encrypted in the browser, and the server
stores only ciphertext. This document covers the keys: where they come from,
where they are kept, and what the guarantee actually is. The messaging feature
itself is [docs/messaging.md](messaging.md).

Two narrow exceptions now exist for embeds. First, when a new message is sent,
when an older one is being backfilled with no cached preview yet, or when a
viewer has explicitly opted into automatic message-thread embeds and a supported
URL is near the viewport, the client may send that URL to `/api/embed-metadata`
so the server can resolve preview data and hand it back for encryption into the
message's metadata sidecar. Second, if a viewer explicitly clicks to expand a
reddit link, or has already opted into automatic message-thread embeds and the
reddit embed is near the viewport, the client sends that URL to `/api/oembed`
so the server can fetch reddit's CORS-blocked oEmbed endpoint. The server still
does not store message plaintext, but it can now transiently receive those
explicit URLs because some providers do not expose a browser-callable metadata
API. The full behaviour lives in [docs/embeds.md](embeds.md).

## What this does and does not promise

**The server never receives your password.** It receives a value derived from
it, and it cannot get back from that value to your password or to the key that
decrypts your messages.

That is an _operational_ property, not a cryptographic one, and the difference
matters enough to say first. The server also ships the JavaScript that does the
deriving. A server that wanted your password could add a line and get it, and
nothing in the browser would notice.

So what this genuinely buys is narrower than "end-to-end encrypted" usually
suggests, and still worth having:

- No plaintext password in a request log, an error report, a crash dump, or a
  captured request. This codebase has already had two `console.log(form)` calls
  removed for exactly that reason.
- No credential-stuffing value from any of the above, because the value that
  does travel is specific to this app.
- A stolen database is not a login verifier, and does not contain anything that
  decrypts a message.

What it does **not** protect against: a compromised or malicious server serving
modified JavaScript, or script injected into the page. Do not let
`extractable: false` on the cached key (below) become a reason to skip a CSP.

## Deriving the keys

All in the browser, in [`src/lib/crypto/kdf.ts`](../src/lib/crypto/kdf.ts). The
shape is Bitwarden's published design: one expensive derivation from the
password, then two cheap one-way derivations from that.

```
masterKey  = PBKDF2-SHA256(password, "bound-up-mk-v1|" + email, 650_000, 256 bits)
authSecret = HKDF-SHA256(masterKey, info "bound-up-auth-v1")  -> to the server
wrapKey    = HKDF-SHA256(masterKey, info "bound-up-wrap-v1")  -> never leaves
```

`authSecret` is 32 bytes as unpadded base64url — 43 characters — and is
submitted in Better Auth's `password` field. Better Auth hashes it again with
scrypt and a fresh 16-byte per-user salt, which is what stops a stolen database
being a login verifier.

`wrapKey` is produced by `deriveKey` directly as a non-extractable `CryptoKey`,
so it never exists as bytes in JavaScript.

Because HKDF is one-way, the value the server holds cannot be turned back into
`masterKey` or `wrapKey`.

### The limit you cannot design around

Anyone holding the stored wrap can attack it **offline**: guess a password,
derive, try to decrypt. Server-side iterations do nothing against that — this is
the published critique of Bitwarden's design, and it applies here identically.

So the confidentiality of your whole message history is capped by the entropy of
your password. That is why the signup minimum is 12 characters with a strength
meter, why the meter rewards length over punctuation, and why
`/settings/encryption` offers a generated five-word passphrase (~64 bits).

### Things that must never change quietly

- **Email normalisation** is `trim()` + `toLowerCase()`, defined once in
  `normaliseEmail` and nowhere else. Anything cleverer — Gmail dot-stripping,
  plus-address trimming — would be defensible product behaviour and would
  silently change the derived key for every existing account. There are tests
  asserting both are _absent_.
- **The KDF parameters** are compile-time constants, and cannot be per-user.
  Login has to derive before it can ask the server anything, so a "what
  parameters does this email use?" endpoint would answer "does this account
  exist?" for anyone who asked. That is the hole in Bitwarden's
  `/accounts/prelogin`, and it is deliberately not imported here.
  `MASTER_KEY_VERSIONS` is a newest-first ladder so a future change derives
  against the new parameters and falls back to the old ones on a 401, with no
  such endpoint.
- **`src/lib/crypto/kdf.test.ts` holds a frozen vector** for the shipping
  parameters. It is the most valuable test in the feature: it fails if any of
  the above moves, which is the difference between finding out in CI and finding
  out when every user has lost their history.
- **Changing an account's email would invalidate its master key.** The Account
  settings page therefore leaves email read-only for now. If email changes are
  ever added they must re-wrap the identity first and coordinate with auth.

## The identity, and how it is stored

Each user has one long-term age X25519 identity, generated in the browser at
signup.

| Where                       | What                                                                         |
| --------------------------- | ---------------------------------------------------------------------------- |
| `user_keys.recipient`       | The public `age1…`. Stored in the clear — it is public by construction.      |
| `user_keys.embed_auto_load` | Message-thread embed preference. `NULL` means no answer yet.                 |
| `user_key_wraps`            | One row per way to unlock: `(type, params, blob)`. All opaque to the server. |

`blob` is base64url of `12-byte IV ‖ AES-256-GCM(identity) ‖ 16-byte tag`, with
the additional authenticated data set to `"bound-up-wrap-v1|" + recipient`.
That AAD binds a wrap to the public key it belongs to, so a wrap row moved
between accounts fails its tag check instead of decrypting into someone else's
identity.

age's own passphrase mode is deliberately not used for this: it would run scrypt
over a value that is already 650,000 PBKDF2 iterations deep, and would imply to
anyone reading the stored blob that a passphrase existed which the server does
not have.

### Why there are many wrap rows

Two reasons, and the first is load-bearing:

1. **A password change inserts the new wrap _before_ changing the credential.**
   A crash between the two then leaves two password wraps, of which exactly one
   opens under whichever password is now current — rather than none. This is why
   `user_key_wraps` has **no unique index on `(user_id, type)`**; adding one
   would break password changes in a way that only shows up on a mid-request
   failure.
2. A user may hold a password wrap and a passkey wrap at the same time.

### One identity, never rotated

There is no forward secrecy and no revocation, and that is the deliberate trade
for a feature whose whole point is that a new device can download and read the
history. A compromised identity exposes everything, past and future. Rotating
is not an escape either: the server holds ciphertext only, so there is nothing
to re-encrypt from.

The single exception is a forgotten password, which loses the identity outright
and starts a partner-assisted restore — see [docs/messaging.md](messaging.md).

### Passkey unlock

Every passkey is registered with the WebAuthn PRF extension requested
(`registration.extensions` in `src/lib/server/auth.ts`), so it can later unlock
the identity with the same touch that signs the user in:

```
prfOutput = clientExtensionResults.prf.results.first
wrapKey   = HKDF-SHA256(prfOutput, info "bound-up-wrap-prf-v1")
```

The wrap format is identical, so there is exactly one AES-GCM envelope in the
codebase and one set of tests for it.

Four constraints, all of them real:

- **PRF must be requested at credential creation.** A passkey registered before
  this feature existed can never be used for PRF and cannot be upgraded — the
  user has to register a new one.
- **`enabled` is only reported by `create()`**, so it is checked and recorded at
  registration. Discovering the failure at unlock time, on a new device, with no
  password to hand, is the worst possible moment.
- **`prf.eval` versus `prf.evalByCredential`.** `eval` is only valid when
  `allowCredentials` holds at most one entry. Better Auth omits
  `allowCredentials` for a sign-in with no session, so `eval` is right there —
  but populates it with every passkey when a session exists, so the
  unlock-while-signed-in path must use `evalByCredential`.
- **iOS and iPadOS cannot pass PRF to an external authenticator.** A security
  key on an iPhone will not work; platform passkeys do.

The PRF salt is passed from the browser per call, never configured server-side —
extensions configured there are JSON-serialised, and a salt has to arrive as
real bytes. Better Auth's passkey client strips `clientExtensionResults` before
posting the assertion, so the derived secret never reaches the server.

## Import boundaries

- **`src/lib/crypto/**` is browser-only.** Nothing there may be imported from
  `src/lib/server/**` or from any `+*.server.ts`. Every function in it touches
  `crypto.subtle`, IndexedDB or age-encryption.
- **`src/lib/encryption.ts` is pure and alias-free.** The Drizzle schema imports
  its types by relative path, and drizzle-kit loads the schema outside Vite.
  This is why the types and the string logic live there and the cryptography
  lives in `crypto/` — the login page needs the KDF and must not pull in
  age-encryption, which brings ML-KEM with it for a feature this app never uses.
- The server's entire involvement is storing and returning four opaque strings:
  `recipient`, `type`, `params`, `blob`.

## What the forms do

Login and signup are still server form actions with superforms and Zod. Three
things changed:

1. The password `<input>` **has no `name`**, so it is not in the submitted
   FormData whether or not any JavaScript ran. It lives in
   `PasswordField.svelte` rather than `InputField.svelte`, which sets
   `name={field}` unconditionally — a name there would be one thrown exception
   away from posting the plaintext.
2. A hidden `authSecret` field is filled by superforms' `onSubmit`, which is
   awaited before `enhance` dispatches. That is an implementation detail rather
   than a documented contract, so `e2e/encryption.spec.ts` asserts the posted
   body never contains the password.
3. Password strength and confirmation are checked in the browser, because the
   server now sees a fixed-length derived value and cannot tell a passphrase
   from a single character.

**Do not add a `validators` option to either form.** Client-side validation runs
against `$form`, whose `authSecret` is empty until `onSubmit` fills the FormData
and which has no password field at all. It would reject every submission.

Because strength is checked against the component's own state rather than the
FormData, that state has to actually be right — and a password manager can
change an input without producing an event the component can see. This shipped
as a bug: an autofilled 21-character password was refused for being under 12,
while sitting visible in the box. `PasswordField.svelte` therefore reads the
value out of the **native control inside `<wa-input>`'s shadow root**, on the
element's events, on the inner control's events, and once more on a
capture-phase `submit` listener. The element's own `value` property is not
authoritative — after a fill that dispatches nothing it is still stale. The
mechanism, the measurement of which fill paths break, and the regression tests
are described in AGENTS.md and `e2e/helpers.ts`.

This is only a usability bug, never a security one: a password that fails to
reach the component cannot derive a key either, so the failure mode is a
refused submission rather than a weak one.

Password _strength_ being unenforceable server-side looks like a violation of
AGENTS.md invariant 14. It is not: that invariant is about a **permission**
being enforced by a disabled input, which is still forbidden. This is a
**policy** that has structurally moved into the browser, and cannot move back
without giving up the property this whole document is about. The compensating
server-side control is rate limiting on `/sign-in/email`.

### JavaScript was already required

Login and signup cannot work without JavaScript, and could not before this
change either: every text field is a `<wa-input>` custom element whose real
`<input>` only exists once Web Awesome upgrades it, so with scripting disabled
there are no usable inputs on those pages at all. Measured, and pinned by an
e2e assertion. The `<noscript>` block added here explains a dead end that
already existed.

## Where the identity lives on a device

`src/lib/crypto/keystore.ts` caches it in IndexedDB, and `session.svelte.ts`
holds the one piece of state everything reads (`currentKeyring()`).

Four ways a device ends up unlocked, in the order they are tried:

1. **Already cached.** The identity is in IndexedDB from a previous visit.
2. **Just signed in.** The login or signup form derived the wrap key while it
   had the password, and left it in a module-level stash
   (`src/lib/crypto/stash.ts`) for the gate to pick up a moment later. This is
   what makes signing in on a new device unlock with no second prompt. The
   stash is keyed by email and cleared as it is read, so a second sign-in in the
   same tab cannot inherit the first one's key.
3. **The unlock prompt.** A cold start: a new device, a passkey sign-in, or —
   most often — the browser having evicted its storage. iOS drops IndexedDB
   after about a week of not opening the app, so this is a screen a regular user
   sees regularly, and it is designed as one rather than as an error.
4. **No keys at all** (`absent`), which is a legacy or passkey-first account.
   The messaging screens and `/settings/encryption` explain how to set them up
   when that state becomes relevant.

A wrong password is caught by the AES-GCM tag **on the device**, with no server
round trip — so it is answered instantly and tells a watcher nothing.

`EncryptionGate` in the app shell decides which of these applies, once. It is
deliberately not a wall: the guides and the partner screens need no keys, so a
locked device gets a callout and everything else keeps working. The gate only
speaks up once the user has actual message history, which is the point where a
locked or absent key state can strand real data. Only the messaging screens
and `/settings/encryption` render their own locked state, and the gate keeps
quiet on those to avoid two identical unlock forms on one page.

### Two things treated as normal rather than exceptional

- **Not every browser will store a `CryptoKey`.** Some WebKit builds throw
  `DataCloneError` on structured-cloning one, and Safari's private browsing
  restricts IndexedDB. The keystore probes by writing a real key and reading it
  back, once, and falls back permanently to memory — where the identity is held
  as a string and never persisted. The UI says so, because it means an unlock on
  every page load.
- **Storage gets evicted**, as above. Hence path 3 being a first-class screen.

## Changing and resetting the password

The settings split is now deliberate:

- `/settings/security` handles ordinary account-password changes and passkey
  management.
- `/settings/encryption` handles message-key setup, unlock-method management,
  and forgotten-password recovery for message history.

`/settings/security` changes the password in one of two ways, depending on
whether the account already has message keys.

**Changing it** re-seals the same identity, so nothing already sent is lost. The
order is chosen for crash-safety, and there is a test asserting it:

1. Insert the **new** wrap. Both password wraps now exist.
2. Change the credential.
3. Only now retire the old wrap.

Dying between 1 and 2 leaves two wraps of which the old password opens one;
between 2 and 3, two of which the new password opens one. Unlock tries each in
turn, so neither loses the identity. If step 2 fails outright the new wrap is
rolled back.

The old password is checked **in the browser** first, by opening the existing
wrap with it. A wrong one therefore fails before anything is sent.

If the account has no message keys yet, `/settings/security` still changes the
Better Auth credential without writing any wrap rows.

`/settings/encryption` still covers the message-specific paths. **Forgetting the
password** is not recoverable, and the screen says so in as many words. What it
offers instead: set a _new_ password, generate a _new_ identity, and ask each
partner to re-encrypt the shared history to it — see
[docs/messaging.md](messaging.md). That needs an authenticated session, which
today means a passkey, so `clearPasswordCredential` nulls the stored credential
and `setPassword` writes the new one. (`setPassword` throws
`PASSWORD_ALREADY_SET` otherwise, and `changePassword` needs the old password,
which is precisely what is missing.)

**Setting up encrypted messages on an account with a password but no keys**
verifies the password before sealing anything to it — via a no-op
`changePassword`, which is the only way to ask Better Auth "is this the current
password?". Sealing to a mistyped password would produce a key that looks fine
and can never be opened.

The last remaining unlock method cannot be removed. A recipient with no wraps is
an identity nobody can open again, and the tempting recovery from it —
generating a fresh key — silently orphans every message the user has received.

## Trust on first use

The server hands you your partner's public recipient, so a dishonest server
could hand you its own and read everything you send afterwards. Nothing in the
protocol prevents that. What the design gives you instead is that a
**substitution is visible**.

- **A safety number.** The first 80 bits of
  `SHA-256("bound-up-safety-v1\n" + the two recipients, sorted)`, as Crockford
  base32 in groups of four. Sorted so both people derive the same string without
  either needing to know who is "first"; Crockford because it has no I, L, O or
  U to misread aloud. 80 bits makes forging a match a 2^80 search, and 16
  characters is short enough to read down a phone line without losing your
  place. The copy tells you to compare it **somewhere other than this app**,
  which is the whole point — a server that can swap a key can also swap what
  both people see on screen.
- **Pin on first sight, and never re-pin silently.** A mismatch is the signal
  the whole mechanism exists to produce, so it has to survive the load that
  notices it. Accepting a changed key is a separate, deliberate act, and the new
  pin is **unverified** whatever the old one was — carrying verification across
  a key change would defeat the point of having pinned anything.
- **Your own recipient is pinned too**, separately. A server that swapped
  _your_ key would make everything your partner sends undecryptable by you,
  which without a pin looks like data loss rather than an attack. The two
  mismatches read very differently and are worded differently.
- **A changed key blocks sending** — on the board and in the thread, since a
  reply is a send too — until the user explicitly accepts it. The banner says
  that already-received messages stay readable, because "key changed" otherwise
  reads as "your history is gone" and would make the safe action look expensive.

Two things about this that look like flaws and are not:

**The blocking is client-side only, necessarily.** The server is the adversary
in this threat model, so it cannot be asked to enforce a warning about itself.
This is _not_ the thing AGENTS.md invariant 14 forbids — that is about a
_permission_ being enforced in the browser, which is still forbidden. There is
no server-side version of this check to have skipped.

**A device that cannot remember keys does not block sending.** The keystore
already falls back to memory when IndexedDB refuses it, so reaching that state
means something more unusual — and refusing to let someone message their partner
because their browser will not persist a pin would be the wrong trade. The UI
says so instead.

## Not built yet

The honest boundary of the above:

- **Passkey unlock.** Passkeys are already registered with PRF requested, so
  the credentials can do it, but nothing derives from the PRF output yet and no
  `webauthn-prf` wrap is ever written. The schema and the derivation
  (`deriveWrapKeyFromPrf`) are in place and tested.
- **Pins do not survive a new device.** They live in IndexedDB, per device, so a
  new phone trusts what it is first told and a device change is
  indistinguishable from a substitution until the number is compared again.
  `user_keys.sealed_pins` — the pin list age-encrypted to your own recipient —
  would fix it and is not built. Until then the UI shows _when_ a key was first
  seen, so "first seen a moment ago" cannot be mistaken for "first seen two
  years ago".
- **Nothing delivers a recipient out of band.** The noted follow-up is to put
  the inviter's recipient in the invite URL's _fragment_, which never reaches
  the server — genuine out-of-band key delivery that would remove
  trust-on-first-use for that direction entirely. It needs the inviter to hold
  keys at invite-creation time, so it is a change to the partners flow rather
  than this one.
