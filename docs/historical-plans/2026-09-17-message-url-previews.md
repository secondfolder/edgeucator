## Plan: Persist Message URL Previews

Persist per-message URL preview data in an encrypted sidecar column on `messages` rather than folding it into the main body ciphertext. That keeps preview metadata behind unlock, avoids plaintext metadata in D1, and gives the app an independent place to cache or refresh unfurl data without rewriting the message body itself. The tradeoff is a real schema and restore cost: every message read shape and the history-restore flow must carry a second encrypted field.

**Steps**
1. Confirm the storage model: add a nullable encrypted sidecar such as `metadataCiphertext` on the `messages` table in /Users/callumgare/repos/edgeucator/src/lib/server/db/schema/app.ts. Keep it encrypted to the same recipients as the body and keep it hidden behind unlock. This preserves the current “server stores ciphertext only” posture while separating author-written content from derived preview metadata.
2. Define a small, versioned metadata payload in /Users/callumgare/repos/edgeucator/src/lib/crypto/messages.ts for per-message derived metadata. Recommended shape: an envelope object rather than a bare array, for example a `MessageMetadataPayload` with a property such as `embeds` holding the normalized preview entries keyed by URL order. Keep only the fields the UI actually needs such as URL, canonical URL, provider name, title, description, thumbnail URL, favicon URL, theme color, embed summary, and a fetch timestamp such as `fetchedAt`, so future metadata categories can be added alongside `embeds` without another schema change and later cache invalidation has a date to work from. Do not add a freshness policy in this first pass; once a valid entry exists it is reused.
3. Add a first-party unfurl/fetch layer that the composer can call before encrypting metadata. Recommended shape: a new server endpoint accepts explicit URLs from the browser, fetches metadata from providers or page HTML, and returns a normalized preview object. This depends on 1 and 2.
4. Update /Users/callumgare/repos/edgeucator/src/lib/messaging/client.ts so compose-time plaintext URL extraction happens before send, preview fetching is best-effort and bounded, and the browser posts two encrypted values for new messages: the existing body ciphertext and the new metadata ciphertext. Message send must still succeed if unfurling fails or times out; in that case `metadataCiphertext` stays null.
5. Update the thread board query path in /Users/callumgare/repos/edgeucator/src/lib/server/messaging.ts to return the first message’s metadata ciphertext alongside `previewCiphertext`. This lets /Users/callumgare/repos/edgeucator/src/lib/components/ThreadSticker.svelte render richer thread previews immediately after decrypt, without a second metadata fetch. This depends on 1 and 4.
6. Update the thread view read path in /Users/callumgare/repos/edgeucator/src/lib/server/messaging.ts and /Users/callumgare/repos/edgeucator/src/lib/types.ts so each `MessageView` can carry optional metadata ciphertext as a sibling to `ciphertext`. The UI can then prefer cached preview metadata and fall back to the current live unfurl logic for older rows without metadata. This can run in parallel with step 5 after step 4.
7. Update /Users/callumgare/repos/edgeucator/src/lib/components/UrlEmbed.svelte and any message bubble render path to short-circuit on decrypted cached preview data when present, while preserving the current runtime fetch path for legacy messages and for URLs whose metadata was not fetched at send time.
8. Extend partner-assisted restore. Because restore currently reads and rewrites only `messages.ciphertext` and `message_reactions.ciphertext` in /Users/callumgare/repos/edgeucator/src/lib/server/messaging.ts and /Users/callumgare/repos/edgeucator/src/lib/messaging/restore.ts, it must also read, re-encrypt, and rewrite `metadataCiphertext` when present. This is the main extra complexity versus storing preview data inside the existing message body.
9. Handle backward compatibility. Old messages will have null metadata ciphertext, so the UI must continue to fall back to the current runtime URL parsing and metadata fetch path. Prefer opportunistic client-side backfill as the default: when an old message is opened after unlock and the client resolves valid preview metadata, it should encrypt and write back just the metadata sidecar for that message through a dedicated mutation path only when no cached entry exists yet. Rendering alone does not persist anything in the current app; this needs an explicit update endpoint or equivalent write route scoped to `metadataCiphertext`. That gives gradual backfill through normal usage without any server-side decryption and avoids rewriting rows that already have valid cached metadata. A one-off broader backfill remains possible as a separate client-side maintenance flow if the product later wants faster coverage.
10. Update documentation in /Users/callumgare/repos/edgeucator/docs/messaging.md, /Users/callumgare/repos/edgeucator/docs/embeds.md, and /Users/callumgare/repos/edgeucator/docs/privacy.md to explain the second encrypted column, what it contains, and that the first-party unfurl endpoint sees explicit URLs at send time but D1 still stores only ciphertext.
11. Copy this exact plan into /Users/callumgare/repos/edgeucator/docs/historical-plans/ once implementation is complete, per repo convention.

**Relevant files**
- /Users/callumgare/repos/edgeucator/src/lib/server/db/schema/app.ts — add the new nullable `metadataCiphertext` column on `messages` and keep comments explicit about it being encrypted derived metadata.
- /Users/callumgare/repos/edgeucator/src/lib/server/messaging.ts — expand `messageColumns`, add a `previewMetadataCiphertext` board subquery, and extend history-restore reads and writes.
- /Users/callumgare/repos/edgeucator/src/lib/types.ts — add optional message metadata ciphertext fields to `ThreadStickerView` and `MessageView`.
- /Users/callumgare/repos/edgeucator/src/lib/crypto/messages.ts — define the encrypted metadata payload shape and encode or decode helpers.
- /Users/callumgare/repos/edgeucator/src/lib/messaging/client.ts — build and send the second ciphertext alongside the body ciphertext.
- /Users/callumgare/repos/edgeucator/src/lib/components/ThreadSticker.svelte — decrypt and prefer first-message cached preview metadata when present.
- /Users/callumgare/repos/edgeucator/src/lib/components/UrlEmbed.svelte — use cached preview metadata first and fall back to live fetch.
- /Users/callumgare/repos/edgeucator/src/lib/components/RichText.svelte — existing URL tokenization rules to reuse so compose-time extraction matches render-time parsing.
- /Users/callumgare/repos/edgeucator/src/lib/embeds.ts — existing provider classification, safe-URL gating, and normalized metadata types to reuse or split into a shared preview schema.
- /Users/callumgare/repos/edgeucator/src/lib/messaging/restore.ts — browser-side restore loop must re-encrypt the metadata sidecar too.
- /Users/callumgare/repos/edgeucator/src/routes/api/partnerships/[id]/restore/+server.ts — restore contract changes because each message may now carry a second encrypted value.
- /Users/callumgare/repos/edgeucator/docs/messaging.md — currently documents that message rows store ciphertext and thread previews decrypt the first message in-browser.
- /Users/callumgare/repos/edgeucator/docs/embeds.md — currently documents client-side metadata fetch and the special Reddit proxy path.
- /Users/callumgare/repos/edgeucator/docs/privacy.md — needs the policy change if send-time first-party unfurling is added.

**Verification**
1. Add unit tests for the metadata payload shape and any URL-preview normalization helpers in /Users/callumgare/repos/edgeucator/src/lib/crypto/messages.ts and /Users/callumgare/repos/edgeucator/src/lib/embeds.ts.
2. Add server tests for /Users/callumgare/repos/edgeucator/src/lib/server/messaging.ts proving the board and thread reads return the new optional metadata ciphertext fields correctly.
3. Add component tests for /Users/callumgare/repos/edgeucator/src/lib/components/ThreadSticker.svelte proving that a decrypted first message with cached preview metadata renders the richer preview without calling the runtime unfurl path.
4. Add or update component tests for /Users/callumgare/repos/edgeucator/src/lib/components/UrlEmbed.svelte covering cached-preview-first behavior and fallback to live fetch for old messages without cached data.
5. Add restore tests proving metadata sidecars are included in list/apply restore flows and survive re-encryption correctly.
6. Add server or browser tests for the new first-party unfurl endpoint that validate URL allowlisting, provider normalization, timeout or failure fallback, and that send still succeeds when preview fetching fails.
7. Run npm run check, npm run lint, npm test, and npm run test:e2e before calling the change done.

**Decisions**
- Included scope: new messages may cache URL preview details in a second encrypted column so the first message can power richer thread previews after unlock.
- Included scope: old messages may backfill that encrypted metadata opportunistically during normal client usage, but only when no cached entry exists yet and a valid one has been resolved.
- Included scope: the server may see explicit URLs at unfurl time if a first-party preview endpoint is used, but D1 still stores only ciphertext on the recommended path.
- Excluded scope: no server-side decryption of message bodies or metadata.
- Excluded scope: metadata fetch remains best-effort; a send must not depend on every URL preview resolving.
- Excluded scope: no freshness or auto-refresh policy in the first pass; once a valid cached entry exists it is reused.
- Tradeoff accepted: a schema migration and restore-contract expansion are worth the cleaner separation between author content and derived preview metadata.

**Further Considerations**
1. If the metadata is always derived from the message text and never refreshed independently, embedding it inside the existing message body remains the lower-complexity option. The sidecar only pays for itself if you want independent refresh, backfill, or render-specific caching without rewriting the body text.
2. If you later need previews to be queryable without decrypting, the encrypted sidecar still does not help server-side reads. That would be a separate plaintext sidecar or shared URL cache, with a deliberate privacy-model change.
3. If richer thread previews should survive for old history too, the safe backfill path is a client-side maintenance flow after unlock that posts newly encrypted metadata sidecars. A server-side backfill would still require breaking the current encryption boundary.
