## Plan: Restructure Settings

Restructure settings around three clear destinations: Account, Security, and Encrypted messages. Rename the current passkeys route to Security, move the existing password-change flow out of encrypted-message settings into Security, add a new Account page for editing name/email, and hide the Encrypted messages entry on the settings hub unless the signed-in user has any message-thread history. Keep the encrypted-message route itself focused on message-key management, and add a cross-link from Security to Encrypted messages with a note explaining why the user might need it.

**Steps**
1. Phase 1: Settings hub data and route map
2. Add `/Users/callumgare/repos/edgeucator/src/routes/(auth-required)/(app)/settings/+page.server.ts` so the settings hub can return a small `hasMessageHistory` boolean alongside the existing `page.data.user` usage. Reuse the guarded-load pattern already used across settings pages and keep the query explicit and cheap.
3. Update `/Users/callumgare/repos/edgeucator/src/routes/(auth-required)/(app)/settings/+page.svelte` to restructure the list into Account, Security, Partners, and conditional Encrypted messages. Preserve the existing logout form. Change the visible account summary so it points toward the new Account page rather than acting as the only place the user sees name/email.
4. Phase 2: Security route reshape
5. Rename the passkeys settings surface from `/settings/passkeys` to `/settings/security` by moving the route directory and updating every internal link/test/doc reference that points at the old path. Reuse the existing passkey load/component logic rather than reimplementing it.
6. Move the existing password-change UI and server action out of `/Users/callumgare/repos/edgeucator/src/routes/(auth-required)/(app)/settings/encryption/+page.server.ts` and `/Users/callumgare/repos/edgeucator/src/routes/(auth-required)/(app)/settings/encryption/+page.svelte` into the renamed Security page. The Security page should then own passkeys plus password management. Keep the current Better Auth + wrap re-sealing flow intact rather than inventing a second password-change mechanism.
7. Add a link on the Security page to `/settings/encryption` with a short note that encrypted-message settings manage message unlock methods/history keys, so password changes that affect message access may require visiting that page.
8. Phase 3: Encrypted messages scope tightening
9. Trim `/Users/callumgare/repos/edgeucator/src/routes/(auth-required)/(app)/settings/encryption/+page.svelte` so it no longer renders the password-change section and only covers message-key setup, unlock methods, reset/recovery actions, and related encryption state. Keep the existing setup/forget/revoke actions on that route.
10. Add a small helper to `/Users/callumgare/repos/edgeucator/src/lib/server/messaging.ts` to detect whether a user has any message-thread history, and use that helper from the settings hub load. Recommended scope: treat any existing thread membership/history as sufficient to show the Encrypted messages link. Do not add a route-level block unless you explicitly want direct navigation prevented too.
11. Phase 4: New Account page
12. Add `/Users/callumgare/repos/edgeucator/src/lib/schemas/accountForm.ts` with the standard Zod + superforms schema for editable `name` and `email`, following existing schema conventions and keeping constraints/actionable messages in line with the auth forms.
13. Add `/Users/callumgare/repos/edgeucator/src/routes/(auth-required)/(app)/settings/account/+page.server.ts` with a load returning the initialized form and an action that updates the signed-in user row through Drizzle. Reuse the route-action pattern from partner settings: re-read the current user, validate the form, handle duplicate-email failure cleanly, and return the updated form state without redirecting.
14. Add `/Users/callumgare/repos/edgeucator/src/routes/(auth-required)/(app)/settings/account/+page.svelte` using the existing superforms + `InputField.svelte` pattern. Include a link from Account to Security so the user can change their password from the page where they manage name/email.
15. Phase 5: Tests and docs
16. Update node tests around the moved password action so coverage follows the new Security route and the encryption route no longer claims password-changing behavior. Add a new server test file for the Account page action/load covering success, validation failure, and duplicate-email rejection.
17. Update end-to-end coverage to reflect the renamed Security page, the new Account page, the conditional Encrypted messages entry, and the moved password-change journey. Keep changes in existing settings-related specs unless a dedicated settings spec becomes clearer.
18. Update `/Users/callumgare/repos/edgeucator/docs/encryption.md` so it reflects the new split between Security and Encrypted messages. If the settings IA needs repo-level explanation beyond that feature doc, also update `/Users/callumgare/repos/edgeucator/AGENTS.md` only where it states now-wrong route behavior.
19. Because this is a substantial planned change, copy the finalized plan into `/Users/callumgare/repos/edgeucator/docs/historical-plans/` after implementation, using the repository’s dated historical-plan convention.

**Relevant files**
- `/Users/callumgare/repos/edgeucator/src/routes/(auth-required)/(app)/settings/+page.svelte` — current settings hub list and account summary to restructure
- `/Users/callumgare/repos/edgeucator/src/routes/(auth-required)/(app)/settings/+page.server.ts` — new hub load for conditional encrypted-message visibility
- `/Users/callumgare/repos/edgeucator/src/routes/(auth-required)/(app)/settings/passkeys/+page.server.ts` — passkey load logic to carry into Security
- `/Users/callumgare/repos/edgeucator/src/routes/(auth-required)/(app)/settings/passkeys/+page.svelte` — passkey UI to rename/reframe as Security
- `/Users/callumgare/repos/edgeucator/src/routes/(auth-required)/(app)/settings/encryption/+page.server.ts` — current `changePassword` action to move out while preserving wrap-handling behavior
- `/Users/callumgare/repos/edgeucator/src/routes/(auth-required)/(app)/settings/encryption/+page.svelte` — current password-change section to remove and security/encryption copy to adjust
- `/Users/callumgare/repos/edgeucator/src/lib/server/messaging.ts` — add a small message-history existence helper for settings visibility
- `/Users/callumgare/repos/edgeucator/src/lib/schemas/encryptionForms.ts` — existing `changePasswordSchema` to continue reusing from the new Security route
- `/Users/callumgare/repos/edgeucator/src/lib/schemas/accountForm.ts` — new account-edit schema
- `/Users/callumgare/repos/edgeucator/src/lib/components/InputField.svelte` — reuse for account-edit inputs
- `/Users/callumgare/repos/edgeucator/src/routes/(auth-required)/(app)/settings/partners/[id]/+page.server.ts` — reference pattern for superforms server load/action structure
- `/Users/callumgare/repos/edgeucator/src/routes/(public)/login/+page.server.ts` — reference auth error-mapping tone/pattern where useful
- `/Users/callumgare/repos/edgeucator/src/routes/(auth-required)/(app)/settings/encryption/page.server.test.ts` — move/refactor password-action coverage
- `/Users/callumgare/repos/edgeucator/e2e/encryption.spec.ts` — update route names and password-flow navigation
- `/Users/callumgare/repos/edgeucator/docs/encryption.md` — update current-behavior docs for the new settings split
- `/Users/callumgare/repos/edgeucator/AGENTS.md` — update only if route descriptions or conventions become inaccurate

**Verification**
1. Run `npm run check` to catch Svelte/TypeScript issues across the renamed and newly added settings routes.
2. Run `npm run lint` to catch route-link, formatting, and ESLint regressions after path renames.
3. Run the focused node tests for the touched settings routes, especially the moved password-action tests and the new account page server tests.
4. Run the relevant Playwright settings/encryption coverage so the renamed Security route, conditional Encrypted messages entry, and Account edit flow are exercised in a real browser.
5. Manually verify the three key journeys in the app shell: Settings hub on an account with no messages, Settings hub on an account with message history, and the Account→Security→Encrypted messages cross-link flow.

**Decisions**
- Use `/settings/account` as the new editable profile route, because the product wording is “account settings page” and it reads cleanly beside `/settings/security`.
- Interpret “Encrypted messages settings page should only show up if you have any messages in your message history” as navigation visibility on the settings hub, not an access-control block on direct URL entry.
- Keep message-key setup/recovery on the Encrypted messages route even after moving ordinary password changes to Security, because encryption setup/reset still has message-specific behavior that should not be collapsed into general account security.
- Include a Security→Encrypted messages link with explanatory copy, and an Account→Security link for password changes, as part of the page design rather than burying those transitions in the hub only.
- Included scope: route rename, settings hub restructure, moved password-change flow, conditional encrypted-message entry, new account-edit page, tests, and docs.
- Excluded scope: changing bottom navigation, adding email-verification flows, or blocking direct access to `/settings/encryption` for users without history.

**Further Considerations**
1. If direct access to `/settings/encryption` should also be prevented for users with no history, the clean extension is a small route-load guard or explanatory empty state there; this is not required for the current request.
2. If account email updates should trigger any re-authentication or verification in the future, that should be treated as a separate auth feature rather than folded into this settings restructure.
3. If the settings hub becomes crowded after adding Account and Security, group entries into “Account” and “Messages” sections rather than adding more one-off descriptive text on the index page.