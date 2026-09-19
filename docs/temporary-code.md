# Temporary code cleanup

This document tracks code that is intentionally temporary and is expected to
be removed once a specific dependency, platform constraint, or migration window
goes away.

Each section should name:

- what is temporary
- where it currently lives
- what removes the need for it
- what should stay after the cleanup

## Temporal polyfill

The task scheduling layer uses `@js-temporal/polyfill` today, not because the
app wants an abstraction over Temporal, but because the repo still needs a
portable implementation that works across the current browser and runtime set.

The goal is to keep **Temporal-based code** and remove only the **polyfill**
once the app can rely on native Temporal everywhere it cares about.

### Current temporary dependency

- package dependency: `@js-temporal/polyfill`
- current import site: `src/lib/task-schedule.ts`

If more files start importing the polyfill directly, add them to this list so
the eventual cleanup stays explicit.

### What to remove when native Temporal is enough

1. Remove `@js-temporal/polyfill` from `package.json`.
2. Update the lockfile by running the normal package-manager uninstall flow.
3. Replace imports shaped like:

   ```ts
   import { Temporal } from '@js-temporal/polyfill';
   ```

   with code that reads Temporal from the native global instead.

4. Remove any compatibility comments that exist only to explain the polyfill.
5. Re-run the full verification loop, including any browsers the project still
   supports in Playwright.

### What should stay

- The `Temporal`-based scheduling model itself.
- The owner-local wall-clock storage model.
- The task timezone ownership rules.
- Any tests that pin recurrence behavior, DST handling, or timezone-relative
  scheduling outcomes.

The cleanup is specifically **polyfill removal**, not a rewrite away from
Temporal.

## Legacy markdown rich text

Messages, task descriptions and reward descriptions became rich text (see
[docs/rich-text.md](rich-text.md)). Everything written before that is a **plain
string**: the composer was a `<wa-textarea>`, the renderer linkified it and kept
whitespace with `pre-wrap`, and no markdown was ever stored or interpreted.

The app reads both forms today. That is scaffolding, not the design. The
temporary half converts legacy content as it is encountered and — where it is
allowed to — writes the converted form back, so that one day there is nothing
left to read and all of this can be deleted in a single commit.

### Why the client does the converting

For descriptions it need not: the server holds those in plaintext and a batch
script would finish immediately. For **messages it is the only option that
exists.** Bodies are E2E encrypted, so the server cannot read them, cannot
convert them, and never will be able to. The only place a message body can be
converted is a browser holding the key.

Both paths are written the same way anyway, so the cleanup is one deletion
rather than two.

### Current temporary code

Every touch point outside these files carries a `LEGACY-RICHTEXT` comment on
the line that goes, so this is the authoritative list:

```sh
grep -rn 'LEGACY-RICHTEXT' src
```

Whole files, deleted outright:

- `src/lib/richtext-legacy.ts` — plain text → document, including the
  linkifyjs call and the embed insertion
- `src/lib/richtext-legacy-migrate.ts` — convert and write back, both kinds
- `src/lib/server/richtext-legacy.ts` — the permission-checked description writes
- `src/routes/api/partnerships/[id]/legacy-bodies/+server.ts` — message endpoint
- `src/routes/api/legacy-descriptions/+server.ts` — description endpoint

Edits inside files that stay:

- `parseStoredRichText` in `src/lib/richtext.ts` — its legacy branch
- `MESSAGE_BODY_FORMATS` / `isMessageBodyFormat` in `src/lib/messaging.ts`
- `messages.body_format` in the schema, `bodyFormat` in `MessageView`, and the
  column in `messageColumns`
- `migrateMessageBodies` in `src/lib/server/messaging.ts`, and
  `legacyBodiesSchema` in `src/lib/schemas/messageForm.ts`
- the migration triggers in `ThreadView.svelte`, `RewardList.svelte` and
  `ManagedTaskList.svelte`
- the legacy branch in `src/lib/schemas/richTextField.ts`
- `markMessageBodyLegacy` in `src/lib/testing/fixtures.ts`, and the
  `LEGACY-RICHTEXT`-marked `describe` blocks in `richtext.test.ts`,
  `RichText.svelte.test.ts` and `server/messaging.test.ts`

### The `body_format` column, and why it exists

The server cannot read a body, so it cannot tell a legacy one from a converted
one. `messages.body_format` is a plaintext, closed two-value enum
(`'plain' | 'lexical'`) that lets it. Same shape and same reasoning as
`message_threads.icon` under AGENTS.md invariant 14: two fixed values leak
nothing about content, where a free-text column would be a covert channel.

It earns its place three times:

1. **The migration endpoint is strictly one-way.** `migrateMessageBodies`
   updates only rows where `sender_id = <caller>` **and**
   `body_format = 'plain'` **and** the thread is in this partnership. A row
   already converted cannot be touched again, so an endpoint that lets a client
   replace stored message bodies can never become a general "edit any message I
   sent" backdoor — messages are otherwise immutable by design. Those three
   clauses are the entire security model and are covered by tests in
   `src/lib/server/messaging.test.ts`.
2. **"Are we done?" is a query rather than a guess** (below).
3. The client can find its own un-migrated messages without decrypting
   every one first.

### What removes the need for it

Both of these reaching zero **in production**, with enough margin that no
client is still holding an unsynced draft:

```sql
-- Messages still in the old form.
select count(*) from messages where body_format = 'plain';

-- Descriptions still in the old form: a document always starts `{"root"`.
select
  (select count(*) from self_rewards        where description is not null and description not like '{"root"%') +
  (select count(*) from partnership_rewards where description is not null and description not like '{"root"%') +
  (select count(*) from self_tasks          where description is not null and description not like '{"root"%') +
  (select count(*) from partnership_tasks   where description is not null and description not like '{"root"%');
```

**The caveat that will bite.** A message encrypted to a key its owner no longer
has can never be migrated _by anyone_, because nobody can read it. Those rows
may sit at `'plain'` for ever. The real criterion is therefore "zero legacy
rows that anyone can still decrypt", and the final cleanup may have to accept a
residue that renders as unreadable either way — which is what it already does
today. Do not wait for a literal zero.

### What to remove when the counts reach zero

1. Delete the three files above.
2. Remove every line found by the `grep`, and `parseStoredRichText` collapses to
   `parseRichTextDocument(stored) ?? emptyRichTextDocument()`.
3. Drop the `body_format` column with a generated migration — read the SQL,
   commit it, never `drizzle-kit push` (invariant 6).
4. Re-run the full verification loop, including `npm run test:e2e`.

### What should stay

- The document format, `RichText.svelte`, the editors, and the golden-file
  shape test in `richtext.test.ts`.
- **`linkifyjs` stays a dependency.** It leaves the read path, but the editor
  still uses it as the auto-link matcher — it is the one answer to "is this a
  URL", and removing it would change what counts as a link.
- The `richTextFieldSchema` sanitising behaviour, which is not about legacy
  content at all.
