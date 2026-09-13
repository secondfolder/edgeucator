# Database

This document covers the repo's database workflow beyond the short command list
in `README.md`.

## Migrations

Generate migrations from schema changes with an explicit, meaningful name:

```sh
drizzle-kit generate --name add_rewards
```

Or through the repo script when it has been updated to pass a name.

Do not keep Drizzle's random default tag. Migration filenames are part of the
review surface in this repo, and a short descriptive name makes it obvious what
the migration is meant to do when reading `drizzle/`, the journal, and test
failures that reference a migration tag.

The expected flow is:

```sh
npm run auth:schema     # only when Better Auth's generated tables changed
drizzle-kit generate --name <short_name>
npm run db:migrate
```

After generating:

- Read the SQL in `drizzle/000N_<name>.sql` before applying it.
- Commit the SQL migration and updated Drizzle metadata together.
- Never use `drizzle-kit push` in this repo.
