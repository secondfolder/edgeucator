# Rewards

Rewards are two related features that deliberately do **not** share one table:

- **Self rewards** belong to one user, use one self-managed credit balance, and
  are created, edited and claimed only by that same user.
- **Partnership rewards** belong to one accepted partnership, are managed under
  the partnership's existing `control` setting, and are claimed against the
  viewer's partnership-scoped credit balance.

The split is deliberate. The permission model is different enough between the
two scopes that a single polymorphic table would force every read and write to
branch on nullable scope columns, which is exactly the kind of ambiguity this
codebase tries to keep out of its load-bearing rules.

## Self rewards

Self rewards live on `/home/rewards`, which is reached from the signed-in home
page.

Each user has:

- A list of rewards they can add, edit and mark active or inactive.
- One credit balance they can set directly.
- A claim history showing what they redeemed and what it cost at the time.

Claiming a self reward deducts credits and inserts a history row in the same
`db.batch()`. The reward title, description and cost are copied onto the claim
row so the history stays truthful if the reward is edited later.

Inactive rewards stay visible for management but cannot be claimed.

## Partnership rewards

Partnership rewards live on `/partner/[id]/rewards`. The dedicated home rewards
page also shows one section per partner, so a user can browse every partner's
claimable rewards from one place without opening each partner page in turn.

Each accepted partnership has:

- A shared reward list.
- One credit balance per member of the partnership.
- A partnership claim history.

### What control means for rewards

The rewards feature reuses the existing partnership control rule instead of
inventing a second permission system:

| Current control value | Who may manage rewards | Who may claim rewards |
| --------------------- | ---------------------- | --------------------- |
| `inviter`             | inviter only           | invitee only          |
| `invitee`             | invitee only           | inviter only          |
| `both`                | both members           | both members          |

"Manage" means create a reward, edit any reward in the partnership, toggle a
reward active or inactive, and set the **other person's** partnership reward
credits.

"Claim" means redeem an active reward against your own partnership-scoped
credit balance.

### Authorship still matters under shared control

Shared control does **not** mean "everyone can claim everything". A user may
never claim a partnership reward they created themselves.

That rule is independent of later control changes:

- If a reward was created by Ada, Ada can never claim that reward.
- If control later flips from shared to one-sided, claimability still follows
  the current control setting **and** the original authorship.

The authorship check exists because shared control intentionally gives both
people creation rights. Without it, either person could create a reward and
instantly spend their own credits on it, which is the opposite of what the
feature is for.

### Credits

Partnership reward credits are stored per `(partnership_id, user_id)`.

- The controlling side sets the other member's balance directly.
- The claimant sees their own current balance.
- Claiming deducts from the claimant's balance and writes a claim history row
  in the same `db.batch()`.

As with self rewards, claim rows snapshot the reward title, description and
cost so history does not rewrite when a reward changes later.

## Screens

| Route                              | What it shows                                                                                                  |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `/home`                            | The signed-in landing page, with a button through to the rewards hub.                                          |
| `/home/rewards`                    | The rewards hub: self rewards plus a separate section for each partner.                                        |
| `/home/rewards/add`                | The form for creating a self reward.                                                                           |
| `/home/rewards/[rewardId]`         | The edit screen for one self reward, using the same form layout as add.                                        |
| `/home/rewards/history`            | Self reward claim history.                                                                                     |
| `/partner/[id]`                    | A summary page with links to Messages and Rewards.                                                             |
| `/partner/[id]/rewards`            | The partnership reward list, current credits, and buttons through to adding rewards or opening reward history. |
| `/partner/[id]/rewards/add`        | The form for creating a partnership reward.                                                                    |
| `/partner/[id]/rewards/[rewardId]` | The edit screen for one partnership reward, using the same form layout as add.                                 |
| `/partner/[id]/rewards/history`    | Partnership reward claim history.                                                                              |

The signed-in home page no longer carries the full rewards UI directly. It
links to `/home/rewards`, which keeps the route shallow for the landing screen
and gives rewards their own nested page structure, matching the partner flows.

The home rewards page reuses the same credits panel and reward list components
as the partner rewards page, so changes to those shared pieces land in both
places together. Editing no longer happens inline in a rewards list. If a user
may edit a reward, its row shows an edit icon that opens the same form layout
used by the add screen, prefilled with the current values.

The home rewards page's partner sections are intentionally claim-focused rather
than a second management UI. Editing partnership rewards stays on the partner
rewards screen, and creating rewards or reviewing claim history happens on the
dedicated nested pages reached from buttons there.

## Data model

The schema uses six reward tables:

- `self_rewards`
- `self_reward_credits`
- `self_reward_claims`
- `partnership_rewards`
- `partnership_reward_credits`
- `partnership_reward_claims`

All reward ids are text UUIDs, all timestamps use the shared `timestamps`
helper, and all credit rows are unique per owner scope. Partnership-scoped rows
cascade from `partnerships`, so disconnecting removes the live reward data for
that relationship.
