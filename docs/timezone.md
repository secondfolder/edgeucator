# Timezone settings

Every account stores one timezone on the Better Auth `user` row. The value is
used for account-level preferences and for timezone-relative task scheduling; it
is not a security boundary and it is not trusted for anything sensitive.

## Stored value

`user.timezone` is a required text column generated from Better Auth's
`additionalFields` configuration in [src/lib/server/auth.ts](../src/lib/server/auth.ts).
The column has a SQL default of `UTC`, which serves two jobs:

- Existing rows created before the feature are backfilled by the migration.
- Any path that somehow omits a timezone still lands on a valid value instead
  of leaving the row partially written.

The canonical value is always an IANA timezone name such as `Europe/London` or
`America/New_York`.

## Validation and normalisation

Timezone parsing lives in [src/lib/timezone.ts](../src/lib/timezone.ts). The
single source of truth is `canonicalizeTimeZone()`, which asks
`Intl.DateTimeFormat()` to accept or reject a candidate and returns the
canonical name when it succeeds.

The signup form and the account settings form both import the shared
`timezoneField` from [src/lib/schemas/timezone.ts](../src/lib/schemas/timezone.ts),
so the browser form action, the server action, and the banner update endpoint
all agree on what counts as valid.

## Signup

Signup captures the current browser timezone in
[src/lib/components/SignupForm.svelte](../src/lib/components/SignupForm.svelte)
immediately before submit and posts it in a hidden field. The server action in
[src/routes/(public)/signup/+page.server.ts](<../src/routes/(public)/signup/+page.server.ts>)
passes that value straight into `signUpEmail`, so the account is born with a
timezone instead of needing a follow-up update.

If the browser cannot report a timezone, the client falls back to `UTC`.

## Partner-visible timezone use

Accepted partner pages may show the other person's current local time when their
timezone differs from the viewer's. That display is informational only, but it
also sets the visual language for task timezone notes elsewhere in the app.

The key privacy boundary is that the app does not expose arbitrary account
timezone data: a counterpart timezone is only returned through a
membership-checked partnership read.

## Account settings

The editable setting lives on
[src/routes/(auth-required)/(app)/settings/account/+page.svelte](<../src/routes/(auth-required)/(app)/settings/account/+page.svelte>).
That page shows the stored timezone in a searchable dropdown, filters IANA
names as you type, and offers a "Use this device timezone" button that copies
the current browser timezone into the form.

Writes go through Better Auth's `updateUser` API via the shared helper in
[src/lib/server/user-settings.ts](../src/lib/server/user-settings.ts), not a
direct Drizzle update. That keeps account edits aligned with the same auth-owned
user source that populates `locals.user`.

## Mismatch banner

The signed-in app shell mounts
[src/lib/components/TimezoneWarning.svelte](../src/lib/components/TimezoneWarning.svelte)
above page content on `/home`, `/partner/*`, and `/settings*`. The banner is
shown when the current device timezone differs from `page.data.user.timezone`.

It offers two actions:

- `Use <device timezone>` posts to
  [src/routes/api/account/timezone/+server.ts](../src/routes/api/account/timezone/+server.ts)
  and updates the stored account timezone to the device timezone.
- `Dismiss` hides the prompt on the current device only.

## Device-local dismissal

Dismissal is intentionally local storage, not server state. The requirement is
per-device behaviour: dismissing the banner on one laptop must not hide it on a
phone.

The banner stores one value per signed-in user in `localStorage`:

- key: `bound-up:timezone-banner:<userId>`
- value: the device timezone that was dismissed

That means the dismissal is valid only while the device reports the same
timezone. If the device timezone changes later, the stored value no longer
matches and the banner becomes eligible again without any server cleanup.

## Task date ownership

The tasks feature adds a second job for account timezones.

Task dates and datetimes are stored as:

- a **local wall-clock value** like `2026-09-20T10:00`
- plus a stable `timezone_owner_user_id`

That owner reference means "interpret this local wall-clock time in this
person's current account timezone".

This is deliberately different from storing a raw timezone string on the task.
If a user changes their account timezone later, the task remains relative to
that user's timezone instead of being frozen to the old offset.

### What the UI does with that

- Self tasks always use the owner's timezone.
- Partnership task date fields default to the other partner's timezone.
- If the two partners currently share the same timezone, the timezone-owner
  toggle is hidden.
- If they differ, the form shows a toggle between "Your time" and
  "<partner>'s time", including the current relative offset.
- When the app renders a task date belonging to a different timezone than the
  viewer's current timezone, it shows a small note in the same style as the
  partner page's timezone line.

### Schedule math

Task scheduling is implemented in `src/lib/task-schedule.ts` using Temporal via
`@js-temporal/polyfill`.

The important property is not the library but the model:

- parse the local wall-clock task value
- interpret it in the owner's current timezone
- derive an instant for comparisons and storage fields like `next_eligible_at`

See [docs/temporary-code.md](temporary-code.md#temporal-polyfill) for the
cleanup note on removing the polyfill later while keeping the Temporal-based
model.
