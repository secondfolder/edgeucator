# AGENTS.md

Conventions and invariants for this repo. Read this before changing anything.

`README.md` is the human-facing setup guide — first-time setup, deploy, the
three-database story, the full script table. It is not repeated here. This file
covers what an agent needs that the README does not say: where things live, what
will break if you guess, and what "done" means.

## What this is

Bound Up (formerly Edgeucator) is a small SvelteKit 2 / Svelte 5 app on Cloudflare
Workers. A
_guide_ has ordered _edge tasks_; an edge task renders a counter and reveals prose as the
count crosses thresholds. Accounts are email/password + passkeys via Better
Auth. Data is Drizzle over Cloudflare D1 (production) and a local SQLite file
(dev).

Guides, edge tasks, and `src/lib/server/db/seed-data.ts` are explicit adult content.
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

`git commit` also runs husky over the staged files: `npm run check` first
(svelte-check is project-wide, so it cannot be scoped by lint-staged), then
lint-staged (prettier, eslint --fix, then `vitest related --run` on the tests
that import them — config lives in `package.json`). It is a fast partial gate,
not the loop: it does not run the e2e suite, and a commit passing it is not
"done".

Honest baseline as of this writing — `lint`, `check`, `test` and `test:e2e` are
all clean. It was not always so; both suppression conventions below exist
because a warning was either a false positive or an intentional pattern, and
**`npm run check` reporting anything at all means a new problem**, not baseline
noise:

- `npm run lint`: clean. The vendored `.agents/` skills, `skills-lock.json` and
  the frozen `docs/historical-plans/` are excluded in `.prettierignore` — the
  first two because `skills-lock.json` pins them, the last because formatting
  would silently rewrite frozen records (it reflows their tables and changes
  emphasis markers). Keep new files formatted; keep those ignored.
- `npm run check`: **0 errors, 0 warnings.** All TypeScript files across the workspace (root configs, `vitest-setup-client.ts`, `e2e/**/*.ts`) are included in `tsconfig.json` and type-aware ESLint (`eslint.config.js`) so command-line checks catch all errors visible in VS Code. Two `svelte-ignore` conventions
  keep it clean, both because svelte-check ignores `onwarn` in
  `svelte.config.js` — a comment is the only suppression both it and the vite
  dev server respect:
  - Every `<wa-button>` with an `onclick` carries
    `<!-- svelte-ignore a11y_click_events_have_key_events,a11y_no_static_element_interactions -->`.
    The a11y warnings are false positives: `wa-*` elements upgrade to real
    interactive controls, but the compiler only sees an unknown element (it
    classifies interactivity by tag name against HTML-only schemas, so no
    attribute can tell it otherwise — `role="button"`/`tabindex` placate it by
    lying to assistive tech instead). Add one to new ones.
  - Every `superForm(...)` / `formFieldProxy(...)` call seeded from a `data`
    prop carries `// svelte-ignore state_referenced_locally` in the script.
    The initial-capture is deliberate: `superForm` registers its lifecycle
    once and its returned stores are the live connection, so re-deriving it on
    every `invalidate()` would reset the form. Add one to new ones.
- `npm test`: 679 tests. Partners, tasks, and the encryption keys are covered end to end
  at three levels — see **Testing** below. Outside those the net is still thin.
- `npm run test:e2e`: 51 Playwright specs, about 90 seconds once the browser is installed
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

8. **Order edge tasks by `order`, then `id`.** Never by `id` alone — ids are UUIDs,
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

15. **`worker.ts` and `src/lib/server/realtime/durable-object.ts` are a second
    alias-free zone.** They are bundled by wrangler's esbuild, which resolves
    neither `$lib` nor any of SvelteKit's aliases, so every import in them must
    be relative. Two traps live here:

    - **Do not point `main` at `worker.ts`.** `adapter-cloudflare` treats `main`
      as its _output_ path and `rimraf`s it before writing, so
      `"main": "worker.ts"` would make `npm run build` delete the file. `main`
      stays on the adapter default and wrangler takes the entry positionally —
      `wrangler dev worker.ts` / `wrangler deploy worker.ts`.
    - **The two `migrations` in `wrangler.jsonc` are unrelated.**
      `d1_databases[0].migrations_dir` is SQL applied by `npm run db:migrate:d1`;
      the top-level `migrations` array is Durable Object class lifecycle, applied
      by wrangler itself. It uses `new_sqlite_classes`, because SQLite-backed
      Durable Objects are the only kind on the Workers Free plan.

16. **Web Awesome's Lit dependencies must resolve to their `node/` builds in
    the wrangler bundle.** `src/routes/+layout.svelte` statically imports the
    registrations so hydration does not have to fetch them after load, which
    also puts Lit in the server graph. workerd has no `HTMLElement`, so
    `wrangler.jsonc` remaps `@lit/reactive-element` and `lit-html` to their
    packaged `node/` shims; the browser build stays on the normal entries.

    Keep it this way. A browser-only dynamic import fixed the crash too, but it
    moved several hundred requests into hydration under `vite dev` and starved
    signup's `await import('age-encryption')`, leaving the form hung for the
    full timeout. Forcing the global `node` condition fixed Lit but dropped
    `production`, which broke `esm-env` and sent the worker down the dev
    database path. `npm run preview:worker` plus a real page load is still the
    only check that exercises this path.

## Conventions

**Auth state flows one way: server load → `page.data`.** Better Auth's cookies
are httpOnly, there is no client-side auth store, and there must not be one.
`src/lib/auth-client.ts` exists only for the passkey ceremonies, which have to
run in the browser. After a client-side ceremony, `invalidateAll()` before
navigating.

**Never return `locals.user` wholesale from a load.** It is the full DB row and
load data is serialised into the HTML of every page. Whitelist fields, as
`src/routes/+layout.server.ts` does.

**Forms are server form actions + superforms + Zod**, in that arrangement, and the preferred form library must be used for app forms unless a route has a documented reason to deviate:

- Schema in `src/lib/schemas/<name>Form.ts`, exporting the schema and its type.
- `load` returns `await superValidate(zod4(schema))` under a named key.
- The action re-validates, `fail(400, { form })` on invalid, calls
  `locals.auth.api.*` inside `try`, maps `APIError` to `setError`, and
  `redirect(303, …)` on success.
- The component takes the `SuperValidated` object as a prop and builds its own
  `superForm`. Fields go through `InputField.svelte`.
- **An `$effect` that reads the `data` prop re-runs on every `invalidate()`.**
  `data` is reassigned each time a load re-runs, so the effect's dependency is
  the whole prop rather than the field you read from it. For an effect that sets
  something up and tears it down — a subscription, a listener, an observer —
  that means the whole thing is rebuilt on every refresh. Read a `$derived`
  **primitive** instead (`const id = $derived(data.partner.id)`): a derived stops
  propagating when its value is unchanged, so the effect stays put. This shipped
  as a bug in the live message feed, where it silently replaced one long-lived
  `EventSource` with one per message — everything still worked, and on Workers
  each reconnect is a fresh billed Durable Object request. Caught only by an
  e2e assertion that counts constructor calls.
- **Svelte 5 delegates `input`, `click` and friends, and delegation does not
  reliably cross a custom element's shadow boundary.** An `oninput=` on a
  `<wa-textarea>` never fires, because the editable node is in a shadow root.
  `MessageComposer.svelte` attaches its listener with `addEventListener` instead
  and explains why at the site. Note that `InputField.svelte` has the same
  `oninput=` shape and has never visibly broken — it gets away with it because
  `<wa-input>` is form-associated and contributes its own value to the FormData,
  so nothing there depends on the Svelte state updating. Anything that _does_
  depend on it must not use the shorthand.
- **A value can arrive in an input without any event this app can see, so read
  the element, not the event.** A password manager extension fills a field by
  assigning `input.value` and dispatching `new Event('input', { bubbles: true })`
  — which defaults to `composed: false`, so it bubbles inside `<wa-input>`'s
  shadow root, updates the element's own value on the way, and stops dead at the
  boundary. Measured in Chromium against Web Awesome 3: of the five ways a value
  can arrive, real typing and a `composed: true` synthetic event reach Svelte,
  while that extension pattern, a silent `input.value =`, and setting the host's
  own `value` property all leave component state empty. Chrome's built-in
  autofill sends trusted composed events and is fine, which is why this only
  reproduces with an extension installed.

  This shipped as a bug: signup refused an autofilled 21-character password for
  being under 12 characters, because the strength check read component state
  while the password sat visible in the box. `PasswordField.svelte` now listens
  on the inner control as well as the host **and** re-reads the control on a
  capture-phase `submit` listener on `document` — capture is what makes the
  ordering sound, since listeners on an event's own target run in registration
  order regardless of the capture flag. Note the element's own `value` property
  is _not_ authoritative; only the native control it wraps is. Regression tests
  are in `e2e/encryption.spec.ts` under "password manager autofill", and
  `e2e/helpers.ts` documents the measurement. Any future field whose Svelte
  state is load-bearing needs the same treatment.

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

**Save buttons start outlined and become solid only when there is something valid to save.**
An idle save action is secondary, not a call to act. When a form becomes dirty, if the contents is valid then
promote its save button to a solid brand style. On `superForm(...)` screens,
key that off the form's tainted and valid state rather than hand-rolled comparisons so
the button follows the same definition of "unsaved changes" as the form logic.

**Two shells, one per group.** `(public)` renders `SiteHeader` above a centred
800px column; `(auth-required)/(app)` renders a `100svh` flex column whose
`<main>` scrolls and whose `AppNav` bottom bar does not. The root
`+layout.svelte` deliberately renders neither — stacking a top nav on top of the
bottom nav is what moving `SiteHeader` out of it fixed. Each shell sets the
`body` rules it needs through `<svelte:head>`, so they are added and removed
with the layout rather than fighting each other globally.

**`/` is the landing page for everyone; `/home` is the signed-in app.** `/`
does not bounce a session holder any more: its centred CTA says "Sign up"
(with a "Log in" link under it) when logged out and "Start" → `/home` when
logged in. Every post-auth redirect still points at `/home`. The guides live
under it (`/home/guides`, `/home/guides/[id]`), behind the auth guard — the
public surface is only `/`, `/login` and `/signup`.

**Active nav state compares `page.route.id`, never a pathname.** During SSR
`resolve()` returns a path relative to the page being rendered (`./home` on
`/home`, `../home` on `/settings/security`), which never equals
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
  nothing; find the scrolling ancestor instead, as `EdgeTask.svelte` does.
- **`position: fixed`/`sticky` against the viewport, and teleporting to
  `<body>`, both stop working**, because `<body>` does not scroll. A sticky
  element left inside `<main>` pins to the bottom of the scrollport — directly
  above the nav — which is usually what was wanted anyway.

Percentage heights are the third trap: `min-height: 100%` needs an ancestor with
a _specified_ height, and the shell only sets `min-height` on the page wrapper.
Stretch with `flex: 1 1 auto` instead.

**Adding a component that needs DB-shaped data**

Add a narrow view type to `src/lib/types.ts` (`GuideView`, `EdgeTaskView` are the
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

- Every spec imports `test` from `./fixtures`, not `@playwright/test`. The
  fixture wraps `browser` so every page — including contexts the specs create
  by hand — fails the run on browser-engine diagnostics: console warnings and
  errors (minus Chromium's "Failed to load resource" network log, which specs
  intentionally provoke, plus Lit's own dev-mode banner under `vite dev`, plus
  Chromium's WebGL "GPU stall due to ReadPixels" warning from the landing
  page's halftone overlay) and
  uncaught `pageerror`s. This is the only net for problems no assertion can
  see, like an invalid `pattern` attribute
  (Chromium compiles those with the `v` flag; Zod's `z.email()` regex is not
  valid under it, which is why `InputField.svelte` strips `pattern` from
  superforms' constraints before spreading them) or a third-party deprecation
  that still leaves the page working today but would break on the next major.

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

| Doc                                              | Feature                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------- |
| [docs/partners.md](docs/partners.md)             | Linking two accounts: invites, the control permission, the nav tabs       |
| [docs/privacy.md](docs/privacy.md)               | General privacy boundaries: who may see which user data, and why          |
| [docs/rewards.md](docs/rewards.md)               | Self rewards and partnership rewards: credits, claims, control            |
| [docs/tasks.md](docs/tasks.md)                   | Self tasks and partnership tasks: scheduling, credits, timezone ownership |
| [docs/encryption.md](docs/encryption.md)         | Message keys: the client-side KDF, the wraps, what the guarantee is       |
| [docs/halftone.md](docs/halftone.md)             | The landing page's halftone overlay: the screen model and its fixtures    |
| [docs/messaging.md](docs/messaging.md)           | Encrypted partner messages: threads, the board, unread, restore           |
| [docs/timezone.md](docs/timezone.md)             | Account timezone storage, mismatch prompts, and device-local dismissal    |
| [docs/temporary-code.md](docs/temporary-code.md) | Temporary-code cleanup notes, including the Temporal API polyfill         |

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

**Historical plans.** When a substantial plan is finished, copy the exact plan into
`docs/historical-plans/`, filename led by the implementation date as
`YYYY-MM-DD-`, so the directory sorts chronologically. Treat that copy as part
of done, not as optional follow-up, and do it even when the plan only lived in
chat or session memory rather than an existing repo file. Post-implementations
to these plans should generally be avoided as they are intended to be frozen
records of what was intended at a moment: never cite one as current behaviour,
and never update one as the code moves on. If one has to be edited because it
is actively misleading someone, mark the edit inline as post-implementation,
dated, with who changed it and why — never a silent rewrite.

If the implementation diverges from the plan, still copy the exact original
plan and let the code, feature docs, and commit history show what changed.

- Preserve reward authorship across later control changes so claim restrictions do not silently mutate when control flips.

**Further Considerations**

1. If the home page becomes too tall once self rewards, partner rewards, and unread links coexist, collapse each rewards section with a default-open summary rather than moving management off home; that preserves the requested collation without creating a second self-rewards destination.
2. If claim history grows noisy, show a recent slice on home and the fuller history on the partner rewards page while still storing the full claim table from the start.

## Creating Plans/Making Major Changes

Unless the user explicilty indicates otherwise the plan or major change should include:

- [ ] Adding full tests for all requirements.
- [ ] Copying the exact plan file into the `docs/historical-plans` directory.
- [ ] A `docs/<feature name>.md` file should be added when working on a feature that isn't covered by the existing docs,
      or if there is already an existing relevent doc it should be updated. If adding new feature that is a superset of an
      existing feature with an existing doc file consider renaming the existing file under the new superset feature name and
      placing it's existing contents into a new section dedicated to that subfeature.
- [ ] DB migration files should always be created with `drizzle-kit` rather than manually written and they should be
      given a meaningful name. E.g. `drizzle-kit generate --name add_rewards`.

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
