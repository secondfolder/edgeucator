# Tasks

Tasks are a second feature beside rewards and guides. They are user-managed,
credit-awarding pieces of work: completing a task adds reward credits instead
of spending them.

The feature has two scopes, deliberately mirroring rewards:

- **Self tasks** live on `/home/tasks` and belong to one user.
- **Partnership tasks** live on `/partner/[id]/tasks` and belong to one accepted
  partnership.

The split is deliberate. The permission rules are different enough between the
two scopes that one polymorphic table would push every read and write through a
nullable scope branch.

## Edge tasks are unrelated

This feature is unrelated to the guide feature's ordered **edge tasks**.

- Guides still contain ordered edge tasks under `/home/guides/[id]`.
- User-managed tasks are the new credit-awarding feature under `/home/tasks`
  and `/partner/[id]/tasks`.

The codebase now keeps those names separate on purpose so the two concepts do
not silently collide in future work.

## Self tasks

Self tasks are fully self-managed.

- The owner creates, edits, and completes them.
- Completing one awards credits into the owner's existing `self_reward_credits`
  balance.
- A one-off task deactivates itself after completion.
- Repeatable tasks advance their own `next_eligible_at` instead.

The home tasks page shows:

- the owner's current self tasks
- recent self-task completions
- one section per partner containing partner tasks the viewer may complete

## Partnership tasks

Partnership tasks reuse the existing partnership `control` setting, but with a
different split from rewards.

| Current control value | Who may manage tasks | Who may complete tasks |
| --------------------- | -------------------- | ---------------------- |
| `inviter`             | inviter only         | invitee only           |
| `invitee`             | invitee only         | inviter only           |
| `both`                | both members         | both members           |

"Manage" means create tasks, toggle the tasks you created active or inactive,
edit the tasks you created, and choose whose timezone a scheduled task is
relative to.

"Complete" means mark a currently eligible task done and receive its credit
award into your own `partnership_reward_credits` balance for that partnership.

### Authorship still matters under shared control

Shared control does **not** mean someone may complete a task they created, and
it does not let them edit the tasks their partner created.

- If Ada creates a partnership task, Ada may edit it under shared control.
- Ada may not complete that same task.
- Jun may complete it when it is eligible.
- Jun may edit only the partnership tasks Jun created.

If control later changes, old partnership tasks stay in the database but the
tasks page only shows the ones that still belong on the viewer's current side:

- the managing side sees only the tasks they created for their partner
- the completing side sees only the tasks their partner created for them
- shared control shows both again

That rule is independent of later control changes for the same reason as the
reward authorship rule: without it, shared control would let someone mint their
own credits from their own task definitions.

## Scheduling modes

Tasks use one structured schedule object rather than separate table shapes.

Supported modes today are:

- `one-off`
- `rolling-window`
- `after-completion`
- `scheduled`

### One-off

One completion total. The task deactivates after completion.

### Rolling window

The task is completable immediately and either:

- remains always available, or
- becomes temporarily unavailable once it reaches a limit like "3 times per
  week"

`next_eligible_at` stores when the oldest completion still blocking that window
falls out.

### After completion

The next completion becomes available only after a delay relative to the last
completion, such as "2 days after completion".

### Scheduled

The task repeats on a fixed calendar pattern. Supported patterns are:

- every `N` days
- every `N` weeks on selected weekdays
- every `N` months on either a day-of-month or an nth weekday
- every `N` years

End conditions are:

- never
- until a local end datetime
- after `N` occurrences

The app does **not** expose raw RRULE editing, exclusion dates, holiday-aware
calendars, or per-occurrence edits in this first version.

## Timezone ownership

Task dates are not stored as "this happened at 14:00 UTC and therefore means
that forever". They are stored as **local wall-clock values** plus a stable
reference to whose timezone that wall-clock value belongs to.

For self tasks, the owner is always the signed-in user.

For partnership tasks, the stored value points at one specific user in the
partnership:

- the current viewer, or
- their partner

That is why the task tables store `timezone_owner_user_id` rather than a raw
timezone string. If that user later changes their account timezone, the task's
local time remains relative to that person's current timezone instead of being
frozen to the old offset.

### What the UI does

- Partner-task date and datetime fields default to the **other partner's**
  timezone on create.
- If both accounts currently share the same timezone, the timezone-owner toggle
  is hidden.
- If they differ, the form shows a small toggle between "Your time" and
  "Their time", and the partner option includes the current relative offset.
- Anywhere the app shows a task date that belongs to a different timezone than
  the viewer's current timezone, it renders the same compact timezone note
  style used on the partner page.
- One-off tasks show no timezone note, because they have no task-local date or
  datetime to explain.

## Data model

The current schema uses four task tables:

- `self_tasks`
- `self_task_completions`
- `partnership_tasks`
- `partnership_task_completions`

Important fields on the live task rows:

- `title`, `description`, `active`
- `credits_awarded`
- `completion_messages`
- `schedule`
- `timezone_owner_user_id`
- `last_completed_at`
- `completed_count`
- `next_eligible_at`

Completion rows snapshot:

- the title and description as completed
- the credit award amount
- the specific completion message shown
- who created the task for partnership rows
- who completed it for partnership rows

The snapshot exists for the same reason as rewards history: visible history must
stay truthful even if the live task is edited later.

## Route surface

| Route                          | What it shows                                                  |
| ------------------------------ | -------------------------------------------------------------- |
| `/home/tasks`                  | Self tasks plus one summary section per partner when any exist |
| `/home/tasks/add`              | Create a self task                                             |
| `/home/tasks/[taskId]`         | Edit one self task                                             |
| `/home/tasks/history`          | Self task completion history                                   |
| `/partner/[id]/tasks`          | Partnership tasks, split by assignee under shared control      |
| `/partner/[id]/tasks/history`  | Partnership task completion history                            |
| `/partner/[id]/tasks/add`      | Create a partnership task when this side controls tasks        |
| `/partner/[id]/tasks/[taskId]` | Edit one partnership task when this side controls tasks        |

The home tasks page now uses the same section pattern as the partner page:
self tasks always exist, partner sections appear only when there are incoming
partner tasks to show, and a single section renders directly on the page rather
than inside a panel. Completion history lives on dedicated routes for both self
tasks and partnership tasks.
