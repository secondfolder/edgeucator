# Plan: embed auto-load consent and viewport activation

1. Add a stored user preference for message-thread URL embeds, scoped with the other encrypted-message settings. It must support three states: no answer yet, opted in, opted out.
2. Keep the current manual `Show` flow as the default. On a device where the user has not answered yet, count manual `Show` clicks for message-thread embeds locally and, on the third click, open a small dialog explaining that loading embeds sends the URL to Bound Up's servers and that those lookups are never logged.
3. If the user answers yes, store that opt-in on the account, immediately switch the current thread to automatic embed loading, and use the stored preference on future visits to message threads. If the user answers no, store the opt-out and do not prompt again.
4. Auto-load mode should not eagerly activate every third-party resource at once. Render stable loading skeletons for all supported embeds immediately to reduce layout shift, but only fully load embeds that are actually in view or close enough that loading them now is likely to matter.
5. Reuse cached encrypted embed metadata in those skeletons wherever possible. Titles, provider names, and other already-cached details can show immediately; third-party iframes and remote media should stay deferred until activation.
6. Add viewport-aware activation with a small delay heuristic based on scroll velocity so fast scrolling does not waste work on embeds the user is likely to pass before they load. If the user stops with an embed still near view, let that stop collapse the delay rather than holding the embed back unnecessarily.
7. Add a control for the same preference to Encrypted messages settings so the user can change it later.
8. Cover the feature with focused component tests for skeleton and activation behavior and browser coverage for the third-click consent prompt, persisted opt-in, and settings toggle.
9. Update the embed, messaging, encryption, and privacy docs to describe the new preference, prompt, and auto-load behavior.
