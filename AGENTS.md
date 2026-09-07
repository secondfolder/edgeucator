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

| Path                          | What lives there                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| `src/hooks.server.ts`         | The per-request wiring: builds `db` + `auth`, resolves the session, mounts Better Auth       |
| `src/lib/server/db/`          | Schema, Drizzle client factories, seed. **Alias-free zone** — see Invariants                 |
| `src/lib/server/auth.ts`      | The Better Auth factory. Every auth option has a comment saying why it is set                |
| `src/lib/schemas/`            | Zod form schemas, shared by the server action and the client component                       |
| `src/lib/types.ts`            | Types both server and components need. Alias-free so the schema can import it                |
| `src/lib/components/`         | Presentational Svelte components                                                             |
| `src/lib/partnership.ts`      | The partners domain rules. Alias-free. See [docs/partners.md](docs/partners.md)              |
| `src/lib/testing/`            | Test-only helpers: in-memory DB, fixtures, a fake `RequestEvent`. Never imported by app code |
| `e2e/`                        | Playwright specs. Run against `vite dev` on port 5175 with their own SQLite file             |
| `src/routes/(public)/`        | Anonymous-reachable routes. `+layout.svelte` here owns `SiteHeader`                          |
| `src/routes/(auth-required)/` | Guarded by a group `+layout.server.ts` that redirects to `/login`                            |
| `.../(auth-required)/(app)/`  | The signed-in app shell: fixed-viewport layout plus the `AppNav` bottom bar                  |
| `drizzle/`                    | Generated migrations + snapshots. **Committed.** Never hand-edit                             |

## The verification loop

Run before declaring anything done:

```sh
npm run check    # svelte-check
npm run lint     # prettier --check && eslint
npm test         # vitest, both projects, single run
npm run test:e2e # playwright, real browser against vite dev
npm run format   # fixes prettier complaints
```

Honest baseline as of this writing — `test` and `test:e2e` are clean, `check`
and `lint` are not. Do not assume you caused the existing problems, and do not
"fix" them as a drive-by inside an unrelated change:

- `npm run lint`: **fails on ~110 files, none of them source.** 108 vendored
  files under `.agents/skills/**` plus `skills-lock.json` (added by
  `chore: add webawesome skills`, never run through prettier) and one
  space-indented line in `vite.config.ts`. The vendored skills probably want a
  `.prettierignore` entry rather than reformatting, since `skills-lock.json`
  pins them. `npx eslint .` on its own is clean.
- `npm run check`: **0 errors, 32 warnings.** Nearly all are a11y warnings on
  `wa-*` custom elements (`a11y_click_events_have_key_events`,
  `a11y_no_static_element_interactions`) plus a few `state_referenced_locally`.
  Svelte cannot know a `<wa-button>` is a button.
- `npm test`: 443 tests. Partners and the encryption keys are covered end to end
  at three levels — see **Testing** below. Outside those the net is still thin.
- `npm run test:e2e`: 27 Playwright specs, ~52s once the browser is installed
  (`npx playwright install chromium` first). A run that takes ~2 minutes has
  something hanging on its 90-second timeout, not something slow.

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

11. **Never pass `undefined` to a boolean attribute on a `wa-*` element.**
    `disabled={busy || undefined}` looks like the usual "omit the attribute"
    idiom, but once Web Awesome upgrades the element Svelte assigns to the
    `disabled` _property_, and this alpha coerces `undefined` to true — leaving
    the control permanently disabled. Write `disabled={busy}`. This silently
    broke the "Add a passkey" button until the Playwright suite caught it.

12. **Never read `partnerships.inviter_name` / `invitee_name` directly.** Which
    of the two is "theirs" flips with who is looking, and getting it backwards
    is the easiest bug in the feature. Go through `viewPartnership()` in
    `src/lib/partnership.ts`, which is the only place that mapping lives. See
    [docs/partners.md](docs/partners.md).

13. **`src/lib/crypto/**` is browser-only.** Nothing there may be imported from
    `src/lib/server/**` or from any `+*.server.ts`. Every function in it touches
    `crypto.subtle`, IndexedDB or age-encryption, and the server's entire
    involvement in encryption is storing and returning opaque strings. The pure
    half — types, constants, normalisation, the safety-number formatting — lives
    in `src/lib/encryption.ts`, which is alias-free so the Drizzle schema can
    import its types. See [docs/encryption.md](docs/encryption.md).

14. **A permission is enforced on the server, never by a disabled input.** The
    read-only accept screen still posts every field (they are hidden inputs, so
    the payload matches the same Zod schema); `acceptInvite` re-reads the stored
    row and ignores them. Same for the edit action, which re-checks `control`
    against the database rather than trusting that the form was hidden.

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
- **Svelte 5 delegates `input`, `click` and friends, and delegation does not
  reliably cross a custom element's shadow boundary.** An `oninput=` on a
  `<wa-textarea>` never fires, because the editable node is in a shadow root.
  `MessageComposer.svelte` attaches its listener with `addEventListener` instead
  and explains why at the site. Note that `InputField.svelte` has the same
  `oninput=` shape and has never visibly broken — it gets away with it because
  `<wa-input>` is form-associated and contributes its own value to the FormData,
  so nothing there depends on the Svelte state updating. Anything that _does_
  depend on it must not use the shorthand.

**Never log a form object.** It no longer contains a plaintext password —
the browser posts a derived value instead (see
[docs/encryption.md](docs/encryption.md)) — but it does contain `authSecret`,
which is a deterministic, permanent login credential for that account and
just as bad to write to a log. Two removed `console.log(form)` calls are
called out in comments so they are not reintroduced.

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

**Two shells, one per group.** `(public)` renders `SiteHeader` above a centred
800px column; `(auth-required)/(app)` renders a `100svh` flex column whose
`<main>` scrolls and whose `AppNav` bottom bar does not. The root
`+layout.svelte` deliberately renders neither — stacking a top nav on top of the
bottom nav is what moving `SiteHeader` out of it fixed. Each shell sets the
`body` rules it needs through `<svelte:head>`, so they are added and removed
with the layout rather than fighting each other globally.

**`/` is the logged-out landing page; `/home` is the signed-in one.** Every
post-auth redirect points at `/home`, and `/` bounces a user who has a session.
The guides live under it (`/home/guides`, `/home/guides/[id]`), so they are
behind the auth guard — the public surface is now only `/`, `/login` and
`/signup`. The landing page still links to the guides, which means an anonymous
visitor is bounced to `/login` and, since the guard does not carry a
`redirectTo`, lands on `/home` rather than the guide they clicked.

**Active nav state compares `page.route.id`, never a pathname.** During SSR
`resolve()` returns a path relative to the page being rendered (`./home` on
`/home`, `../home` on `/settings/passkeys`), which never equals
`page.url.pathname` — comparing them left the current tab unhighlighted until
hydration. Route ids are identical on both sides.

**CSS lives in the component's `<style>` block**, nested, no framework.

**Two links must not share an accessible name.** The `(public)` header already
has "Login" and "Sign up"; the invite page's own buttons are "Log in to accept"
and "Create an account" for that reason. Duplicate names are a real problem for
anyone navigating by link list, and they make a test locator ambiguous — which
is how this one was noticed.

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

A signed-in screen goes one level deeper, in `(auth-required)/(app)/`, which
adds the app shell: `<main>` is the only thing that scrolls and `AppNav` is
pinned under it. Anything outside that group renders without the bottom bar, so
put a page there only if it is deliberately chrome-less.

Two consequences bite anything moved into the shell, and both already cost a
debugging round on the guides:

- **The window no longer scrolls.** `window.scrollY` / `window.scrollTo` move
  nothing; find the scrolling ancestor instead, as `Task.svelte` does.
- **`position: fixed`/`sticky` against the viewport, and teleporting to
  `<body>`, both stop working**, because `<body>` does not scroll. A sticky
  element left inside `<main>` pins to the bottom of the scrollport — directly
  above the nav — which is usually what was wanted anyway.

Percentage heights are the third trap: `min-height: 100%` needs an ancestor with
a _specified_ height, and the shell only sets `min-height` on the page wrapper.
Stretch with `flex: 1 1 auto` instead.

**Adding a component that needs DB-shaped data**

Add a narrow view type to `src/lib/types.ts` (`GuideView`, `TaskView` are the
pattern) rather than importing the Drizzle row type. Components must never
import from `$lib/server/**`.

## Testing

Three levels, deliberately. Add to the cheapest one that can catch the bug.

**Pure logic** — `src/lib/*.test.ts`, node project. Permission rules, the
per-viewer view, the redirect allowlist, the Zod schemas. No database, no DOM.

**Server** — `*.test.ts` next to the thing under test, node project. These build
a real SQLite database in memory and call the route's exported `load` /
`actions` directly:

```ts
const { db, close } = await createTestDb(); // $lib/testing/db
const ada = await createTestUser(db); // $lib/testing/fixtures
const data = await runLoad(load(fakeEvent({ db, user: ada }))); // $lib/testing/events
```

- `createTestDb()` applies the committed `drizzle/*.sql` to a `:memory:` libsql
  database. libsql, not better-sqlite3, for the reason `db/dev.ts` gives — the
  async signatures and `batch()` match D1, so a test cannot pass against a
  capability production does not have. Foreign keys are on, as they are on D1.
- Fixtures insert `user` rows directly rather than booting Better Auth, which
  would need a live request context for `sveltekitCookies`.
- `runLoad()` exists only to drop the `void` from `PageServerLoad`'s return
  type; `runAndCatch()` turns a thrown `redirect()` / `error()` into a value.
- **Route test files may not start with `+`** — SvelteKit reserves that prefix
  and refuses to build. Name them `page.server.test.ts`, as the existing
  `page.svelte.test.ts` does.

**Component** — `*.svelte.test.ts`, jsdom project. `$app/state` and `$app/paths`
have to be mocked (`AppNav.svelte.test.ts` shows the shape). A component that
calls `superForm()` can only be tested through a wrapper component, because
`superForm` registers an `onDestroy` and throws outside initialisation — which
is why `PartnerFields` is exercised through `PartnerAcceptForm`.

`wa-*` elements are never upgraded in jsdom (they come from a CDN), so assert on
the attributes the component emits, not on rendered behaviour. Anything that
depends on Web Awesome actually working belongs in the Playwright suite.

**End to end** — `e2e/*.spec.ts`. This is the only level that sees the auth
hook, real session cookies, the `(auth-required)` guard and the round trip
through `/signup?redirectTo=`. It runs `vite dev` on port 5175 against its own
`e2e.db`, rebuilt from the migrations as part of the server command (not in a
`globalSetup` — Playwright starts the web server first, and deleting the file
underneath it leaves every write failing with `SQLITE_READONLY_DBMOVED`).

Notes that cost a debugging round each:

- Web Awesome text inputs are custom elements whose editable `<input>` is in a
  shadow root. Fill them as `wa-input[name=x] input`, which Playwright's
  selector engine reaches.
- A relative glob in `waitForURL` is resolved against `baseURL`, so `'**/'`
  never matches a bare `/`. Pass `'/'`.
- Signing in or up is asynchronous; wait for the form to be left behind before
  the next step or it races the session cookie.
- **Wait for hydration before filling a superforms field, not just before
  submitting.** `InputField.svelte` renders each field's `value` from `$form`,
  so hydration writes the store's value — empty on a fresh form — over anything
  already typed into the DOM. `waitForEnhancedForm` in `e2e/helpers.ts` waits on
  a `data-ready` marker the login and signup forms set from `onMount`. Without
  it, filling email then password then submitting would intermittently leave the
  _email_ box empty (hydration landing between the two fills), native validation
  would refuse to submit the empty required field, and the test hung for its
  full timeout **with no request made and no error anywhere** — about one
  full-suite run in two.
- A `<wa-button type="submit">` only submits once Web Awesome has upgraded it;
  before that a click is silently a no-op that Playwright's actionability checks
  do not catch. `clickWaButton` waits on the custom element registry.
- Anything reached only through `await import()` needs listing in
  `optimizeDeps.include`. Otherwise Vite discovers it mid-run, forces a
  re-optimization, and tells every connected client to reload — which loses an
  in-flight form submit.
- **A `<wa-button href=…>` renders an anchor**, so `getByRole('button')` finds
  nothing. And `getByRole('button')` on a `<wa-button>` resolves to the _inner_
  `<button>` inside its shadow root, which is why `wa-button[type=submit]` as a
  selector matches nothing once the element has upgraded.
- **A visually hidden input cannot be clicked.** The thread icon picker hides
  its radios with `clip-path`, so `.check()` waits for visibility and times
  out; click the label by its accessible name instead.
- **An uncaught error during hydration kills the whole component silently.**
  `<wa-textarea autofocus>` throws "Cannot read properties of null (reading
  'focus')" as it upgrades, and the symptom was a send button that never
  enabled — nowhere near the cause. Worth checking `page.on('pageerror')` early
  when a component seems inert.
- The suite is `workers: 1` and not parallel: it shares one database, and each
  test drives two browser contexts so the two accounts hold genuinely separate
  cookies.

## Documentation

Four places, split on scope:

- **`README.md`** — how a human sets up, runs, migrates, and deploys.
- **`AGENTS.md`** — repo-wide conventions and invariants.
- **`docs/<feature>.md`** — how one feature actually works: its data model, its
  rules, and the decisions a reader would otherwise have to reconstruct from
  half a dozen files. For anything whose explanation does not fit in a comment
  at one site.
- **Code comments** — anything one file deep. This project's default is a
  comment at the site, and it is usually the right call.

### Feature docs

| Doc                                      | Feature                                                             |
| ---------------------------------------- | ------------------------------------------------------------------- |
| [docs/partners.md](docs/partners.md)     | Linking two accounts: invites, the control permission, the nav tabs |
| [docs/encryption.md](docs/encryption.md) | Message keys: the client-side KDF, the wraps, what the guarantee is |
| [docs/messaging.md](docs/messaging.md)   | Encrypted partner messages: threads, the board, unread, restore     |

**Keeping these current is part of the change, not a follow-up to it.**

- **Touching a feature that has a doc means updating that doc in the same
  change.** A `docs/*.md` that describes behaviour the code no longer has is
  worse than no doc, because it is trusted. If your change alters a data model,
  a permission rule, a route, an error case, or a decision the doc explains, fix
  the doc before calling the work done.
- **Adding a feature that spans more than a couple of files means writing
  one** — `docs/<feature>.md`, added to the table above. The test: could someone
  who has not read the diff understand the feature without opening five files
  and inferring the rules? If not, it needs a doc.
- Write it as current behaviour, in the present tense, and say _why_ where the
  why is not obvious — that is the half a reader cannot recover from the code.
  It is not a changelog and not a plan; those live in `docs/historical-plans/`.
- Removing a feature removes its doc, and its row in the table.

**The same applies to the rest of the documentation.**

- A change that makes a statement in `README.md`, `AGENTS.md`, a `docs/*.md`, or
  a code comment wrong is not finished until that statement is fixed. The
  "Honest baseline" numbers above included.
- A change that adds a concept someone would need explained gets explained.
- `AGENTS.md` changes when a repo-wide convention or invariant does — a new lint
  rule, a new import boundary, a new directory with rules of its own. A rule
  that applies to one feature belongs in that feature's doc instead.

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
  `server.origin`. Expect to change it, not to inherit it. `server.origin` is
  overridable with `VITE_DEV_ORIGIN`, which is how the Playwright suite runs
  against localhost — with the tunnel baked in, the page asks the tunnel for its
  modules and never hydrates.
- `npm run db:reset` is `rm -f` — destructive and not Windows-portable. So is
  the e2e server command, which deletes `e2e.db` on every run.
- `.npmrc` sets `engine-strict=true` against `node >= 20`.
- Do not add `@cloudflare/workers-types` to a `types` array. It publishes
  ambient globals that would overwrite the DOM's `Request`/`Response`/`fetch`
  for the whole project, including the jsdom test project. This is why
  `app.d.ts` takes `AnyD1Database` from `drizzle-orm/d1` instead.
