<script lang="ts">
	import type { TagView } from '$lib/types';
	import MessageComposer from './MessageComposer.svelte';
	import TagPicker from './TagPicker.svelte';

	let {
		partnerName,
		partnershipId,
		send,
		close,
		tags
	}: {
		partnerName: string;
		partnershipId: string;
		send: (message: { text: string; files: File[] }, tagIds: string[]) => Promise<string | null>;
		close: () => void;
		tags: TagView[];
	} = $props();

	let selectedTagIds = $state<string[]>([]);

	function onAfterHide(event: Event) {
		// `wa-after-hide` bubbles from nested Web Awesome controls such as the tag
		// dropdown. Only the dialog's own hide should unmount the composer.
		if (event.target !== event.currentTarget) return;
		close();
	}

	function sendWithTags(message: { text: string; files: File[] }) {
		return send(message, selectedTagIds);
	}
</script>

<!--
	No `light-dismiss`: the tag picker's dropdown opens in a popup layer that the
	dialog counts as an outside click, so selecting a tag flashed the chip and
	closed the whole dialog mid-compose. The dialog still listens for its own
	`wa-after-hide`, but only after filtering out bubbled hide events from nested
	Web Awesome controls. Caught by the Playwright test
	"picking a tag in the composer keeps the dialog open".
-->
<wa-dialog
	label={`Send to ${partnerName}`}
	class="composer-dialog"
	open
	onwa-after-hide={onAfterHide}
>
	<div class="composer">
		<div class="top-row">
			<TagPicker {partnershipId} {tags} bind:selectedIds={selectedTagIds} startEditing />
			<!-- svelte-ignore a11y_click_events_have_key_events,a11y_no_static_element_interactions -->
			<wa-button appearance="plain" class="dialog-close" aria-label="Close" onclick={close}>
				<wa-icon name="xmark" variant="solid" label="Close"></wa-icon>
			</wa-button>
		</div>
		<!--
		No autofocus. `<wa-textarea autofocus>` reaches for its inner textarea
		before the shadow root exists and throws "Cannot read properties of null
		(reading 'focus')" — an uncaught error during hydration, which stops
		Svelte wiring up the rest of the component and leaves the whole composer
		dead. Focusing the host by hand after `updateComplete` had the same
		effect. The composer appears on a tap, so the user is already looking at
		it.
	-->
		<MessageComposer send={sendWithTags} placeholder={`Message to ${partnerName}`} />
	</div>
</wa-dialog>

<style>
	wa-dialog.composer-dialog {
		--width: min(44rem, calc(100vw - 2rem));
		--spacing: var(--wa-space-m);
		--backdrop-filter: brightness(0.45) blur(0.3rem);
	}

	wa-dialog.composer-dialog::part(dialog) {
		inline-size: min(44rem, calc(100vw - 2rem));
		margin: auto;
		padding: 0.5em;
		max-inline-size: none;
		max-block-size: min(80svh, 42rem);
		border-radius: 1.25rem;
		background: var(--wa-color-surface-raised, var(--wa-color-surface-default, white));
		border: 1px solid var(--wa-color-surface-border);
		box-shadow: 0 1.5rem 4rem rgb(0 0 0 / 28%);
	}

	wa-dialog.composer-dialog::part(header) {
		display: none;
	}

	wa-dialog.composer-dialog::part(body) {
		padding: 0;
		background: var(--wa-color-surface-raised, var(--wa-color-surface-default, white));
	}

	wa-dialog.composer-dialog::part(close-button__base) {
		border-radius: 999px;
	}

	.composer {
		inline-size: 100%;
		block-size: 100%;
	}

	.top-row {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;

		:global(.tag-picker) {
			flex: 1 1 auto;
			min-inline-size: 0;
		}
	}

	wa-button.dialog-close {
		flex: none;
		margin-inline-start: auto;
	}

	wa-button.dialog-close::part(button) {
		inline-size: 2.75rem;
		block-size: 2.75rem;
		padding: 0;
		border-radius: 999px;
	}

	wa-button.dialog-close::part(label) {
		display: grid;
		place-items: center;
	}
</style>
