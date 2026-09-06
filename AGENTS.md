# AGENTS.md

Conventions and invariants for this repo. Read this before changing anything.

`README.md` is the human-facing setup guide — first-time setup, deploy, the
three-database story, the full script table. It is not repeated here. This file
covers what an agent needs that the README does not say: where things live, what
will break if you guess, and what "done" means.

## What this is

Edgeucator is a small SvelteKit 2 / Svelte 5 app on Cloudflare Workers. A
_guide_ has ordered _tasks_; a task renders a counter and reveals prose as the
count crosses thresholds. Accounts are email/password + passkeys via Better
Auth. Data is Drizzle over Cloudflare D1 (production) and a local SQLite file
(dev).

Guides, tasks, and `src/lib/server/db/seed-data.ts` are explicit adult content.
That is the point of the app, not a mistake. Treat that prose as data: do not
rewrite it, sanitise it, or reflow it (it is in `.prettierignore` precisely so
one entry stays on one line).

## Repo map

| Path                          | What lives there                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------- |
| `src/hooks.server.ts`         | The per-request wiring: builds `db` + `auth`, resolves the session, mounts Better Auth |
| `src/lib/server/db/`          | Schema, Drizzle client factories, seed. **Alias-free zone** — see Invariants           |
| `src/lib/server/auth.ts`      | The Better Auth factory. Every auth option has a comment saying why it is set          |
| `src/lib/schemas/`            | Zod form schemas, shared by the server action and the client component                 |
| `src/lib/types.ts`            | Types both server and components need. Alias-free so the schema can import it          |
| `src/lib/components/`         | Presentational Svelte components                                                       |
| `src/routes/(public)/`        | Anonymous-reachable routes                                                             |
| `src/routes/(auth-required)/` | Guarded by a group `+layout.server.ts` that redirects to `/login`                      |
| `drizzle/`                    | Generated migrations + snapshots. **Committed.** Never hand-edit                       |

## The verification loop

Run before declaring anything done:

```sh
npm run check    # svelte-check
npm run lint     # prettier --check && eslint
npm test         # vitest, both projects, single run
npm run format   # fixes prettier complaints
```

Honest baseline as of this writing — `lint` and `test` are clean, `check` is not.
Do not assume you caused the warnings, and do not "fix" them as a drive-by inside
an unrelated change:

- `npm run lint`: clean.
- `npm run check`: **0 errors, 24 warnings.** Nearly all are a11y warnings on
  `wa-*` custom elements (`a11y_click_events_have_key_events`,
  `a11y_no_static_element_interactions`) plus a few `state_referenced_locally`.
  Svelte cannot know a `<wa-button>` is a button.
- `npm test`: passes. There is **one** test
  ([src/routes/page.svelte.test.ts](src/routes/page.svelte.test.ts)) and it
  asserts an `<h1>` exists. Effectively no safety net — lean on `check` and on
  actually running the app.

Internal links go through `resolve()` from `$app/paths` — `href="/guides"` and a
bare `goto('/')` are both eslint errors under
`svelte/no-navigation-without-resolve`.

If you add a behaviour worth protecting, add a test. `*.svelte.test.ts` runs in
the jsdom project; everything else runs in the node project, which excludes
`src/lib/server/**` from the client project only, not from node.

`npm run preview:worker` is the only local command that exercises the real
Workers runtime. Run it before any change that touches `platform`, the bundle,
`nodejs_compat`, or the D1 path.

## Invariants

These are load-bearing. Each is already explained at length in a comment at the
site it applies to; go read that comment before deciding to break one.

1. **Nothing under `src/lib/server/db/` may import `$lib`, `$env`, `$app`, or
   `cloudflare:workers`.** drizzle-kit and the seed script load those files
   outside Vite, where the aliases do not resolve. `db/dev.ts` is the single
   exception and is imported only from the SvelteKit side. `src/lib/types.ts` is
   alias-free for the same reason.

2. **No module-level `db` or `auth` singleton.** A D1 binding exists only inside
   a request. Both are built per request in `hooks.server.ts` and read from
   `event.locals`. The one cache — `devDb` in `db/dev.ts` — is inside a
   `if (dev)` branch that is dead-code-eliminated from the worker bundle.

3. **`db.transaction()` fails on D1.** It works in dev and will pass every local
   check. Use `db.batch()`. The dev driver is libsql (not better-sqlite3)
   specifically so `batch()` exists and the async signatures match.

4. **`event.platform` means "running on Workers".** `svelte.config.js` strips the
   adapter's `emulate` hook, so `vite dev` has no platform at all. Reach for
   `platform.env` only behind `requireD1()` or a `?? privateEnv.X` fallback, and
   never during prerender — `hooks.server.ts` bails on `building` first.

5. **`Db` is typed as the D1 client.** The dev libsql client is cast to it, so
   application code cannot accidentally depend on a dev-only capability. Do not
   widen this type to make something compile.

6. **Never run `drizzle-kit push`.** Generate a migration, read the SQL, commit
   it. See the comment in `drizzle.config.ts`.

7. **`schema/auth.ts` is generated** by `npm run auth:schema`. Hand edits are
   lost on the next regeneration. App tables go in `schema/app.ts`.

8. **Order tasks by `order`, then `id`.** Never by `id` alone — ids are UUIDs,
   not a sequence. Guides order by `createdAt`, then `id`.

9. **Secrets: `platform.env` in production, `.env` in dev.** `hooks.server.ts`
   throws when `BETTER_AUTH_SECRET` is missing, because Better Auth would
   otherwise silently use a hard-coded default (its own guard only fires on
   `NODE_ENV === 'production'`, which Workers does not set).

10. **Passkeys are bound to a hostname.** One registered on `localhost` will not
    work on the tunnel host or in production. WebAuthn, not a bug.

## Conventions

**Auth state flows one way: server load → `page.data`.** Better Auth's cookies
are httpOnly, there is no client-side auth store, and there must not be one.
`src/lib/auth-client.ts` exists only for the passkey ceremonies, which have to
run in the browser. After a client-side ceremony, `invalidateAll()` before
navigating.

**Never return `locals.user` wholesale from a load.** It is the full DB row and
load data is serialised into the HTML of every page. Whitelist fields, as
`src/routes/+layout.server.ts` does.

**Forms are server form actions + superforms + Zod**, in that arrangement:

- Schema in `src/lib/schemas/<name>Form.ts`, exporting the schema and its type.
- `load` returns `await superValidate(zod4(schema))` under a named key.
- The action re-validates, `fail(400, { form })` on invalid, calls
  `locals.auth.api.*` inside `try`, maps `APIError` to `setError`, and
  `redirect(303, …)` on success.
- The component takes the `SuperValidated` object as a prop and builds its own
  `superForm`. Fields go through `InputField.svelte`.
- **Never log a form object** — it contains the plaintext password. Two removed
  `console.log(form)` calls are called out in comments so they are not
  reintroduced.

**Error messages should be actionable.** The existing ones name the command that
fixes them (`requireD1`, the secret check in `hooks.server.ts`). Match that.

**Auth failures must not leak which factor was wrong.** Login maps 401 to a
single "Invalid email or password" for both unknown email and bad password, and
the login schema deliberately omits the `.min(8)` the signup schema has.

**Queries select columns explicitly.** Use `columns: { … }` and `with: { … }`
rather than selecting whole rows; D1 charges for rows read and response size.

**UI is Web Awesome 3 alpha, loaded from a CDN in `src/app.html`.** Components
are custom elements (`wa-button`, `wa-input`, …) with no TypeScript definitions,
which is why Svelte's a11y warnings fire on them. Style with `--wa-*` custom
properties and `::part()`. Pinned to `3.0.0-alpha.11` — an alpha, so treat a
version bump as a change that needs the app actually opened.

**CSS lives in the component's `<style>` block**, nested, no framework.

**Comments explain _why_, not _what_.** This codebase's distinguishing habit is
that every non-obvious decision carries a comment naming the failure it avoids —
often the specific bug that was hit. Keep that up. When you remove a workaround,
say in the comment why it is no longer needed rather than deleting it silently.

## Recipes

**Adding a column or table**

```sh
# edit src/lib/server/db/schema/app.ts
npm run db:generate      # then READ drizzle/000N_*.sql
npm run db:migrate       # local.db
npm run db:migrate:remote   # production, when deploying
```

Reuse the `timestamps` helper in `schema/app.ts`; its `timestamp_ms` mode and
SQL-side default match what Better Auth generates, and a mismatch makes dates
1000× wrong. Text UUID primary keys, `$defaultFn(() => crypto.randomUUID())`.
Add an index for any query path you introduce. Export `$inferSelect` /
`$inferInsert` types next to the table.

**Adding a route**

Put it under `(public)` or `(auth-required)` — the group is the access control.
Do not hand-roll a session check in a page load when the group already covers
it. Remember form actions run _before_ layout loads, so a group guard does not
gate an action (this is why `/logout` sits under `(public)`).

**Adding a component that needs DB-shaped data**

Add a narrow view type to `src/lib/types.ts` (`GuideView`, `TaskView` are the
pattern) rather than importing the Drizzle row type. Components must never
import from `$lib/server/**`.

## Documentation

There is no `docs/` directory yet. Until there is, `README.md` and this file are
the documentation, split on scope:

- **`README.md`** — how a human sets up, runs, migrates, and deploys.
- **`AGENTS.md`** — repo-wide conventions and invariants.
- **Code comments** — anything one file deep. This project's default is a
  comment at the site, and it is usually the right call.

If a feature ever grows past what a code comment can carry, add `docs/<feature>.md`
and link it from a table here rather than inlining it.

**Documentation is part of a change, not a follow-up to it.**

- A change that makes a statement in `README.md`, `AGENTS.md`, or a code comment
  wrong is not finished until that statement is fixed. The "Honest baseline"
  numbers above included.
- A change that adds a concept someone would need explained gets explained.
- `AGENTS.md` changes when a repo-wide convention or invariant does — a new lint
  rule, a new import boundary, a new directory with rules of its own.

**Historical plans.** When a substantial plan is finished, record it under
`docs/historical-plans/`, filename led by the implementation date as
`YYYY-MM-DD-`, so the directory sorts chronologically. These are frozen records
of what was intended at a moment: never cite one as current behaviour, and never
update one as the code moves on. If one has to be edited because it is actively
misleading someone, mark the edit inline as post-implementation, dated, with who
changed it and why — never a silent rewrite.

## Traps

- `local.db`, `.env`, and `.dev.vars` are gitignored; `drizzle/` is not. Do not
  commit the first three or gitignore the last.
- `.env` (vite dev) and `.dev.vars` (wrangler dev) are **separate files**.
  `preview:worker` reads only the latter.
- `wrangler.jsonc` ships `"database_id": "REPLACE_ME"`. `npm run dev` never
  reads it; `preview:worker` and `deploy` do.
- `vite.config.ts` hardcodes a personal tunnel host in `allowedHosts` /
  `server.origin`. Expect to change it, not to inherit it.
- `npm run db:reset` is `rm -f` — destructive and not Windows-portable.
- `.npmrc` sets `engine-strict=true` against `node >= 20`.
- Do not add `@cloudflare/workers-types` to a `types` array. It publishes
  ambient globals that would overwrite the DOM's `Request`/`Response`/`fetch`
  for the whole project, including the jsdom test project. This is why
  `app.d.ts` takes `AnyD1Database` from `drizzle-orm/d1` instead.
