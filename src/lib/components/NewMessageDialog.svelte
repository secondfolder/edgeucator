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

	function sendWithTags(message: { text: string; files: File[] }) {
		return send(message, selectedTagIds);
	}
</script>

<wa-dialog
	aria-label={`Send to ${partnerName}`}
	light-dismiss
	class="composer-dialog"
	open
	onwa-after-hide={close}
>
	<div class="composer">
		<TagPicker {partnershipId} {tags} bind:selectedIds={selectedTagIds} />
		<!--
		No autofocus. `<wa-textarea autofocus>` reaches for its inner textarea
		before the shadow root exists and throws "Cannot read properties of null
		(reading 'focus')" — an uncaught error during hydration, which stops
		Svelte wiring up the rest of the component and leaves the whole composer
		dead. Focusing the host by hand after `updateComplete` had the same
		effect. The composer appears on a tap, so the user is already looking at
		it.
	-->
		<MessageComposer send={sendWithTags} {close} placeholder={`Message to ${partnerName}`} />
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
</style>
