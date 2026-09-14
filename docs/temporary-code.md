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
