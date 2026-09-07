<script lang="ts">
	import { THREAD_ICONS, THREAD_ICON_LABELS, type ThreadIcon } from '$lib/messaging';

	/**
	 * Which sticker the thread will show on the other person's board.
	 *
	 * Native radios with icon labels rather than `<wa-radio-group>`, following
	 * `PartnerFields.svelte` — and for a related reason: this value is the one
	 * plaintext thing the message carries, it must always submit, and the
	 * Playwright suite needs to be able to drive it as
	 * `input[name="icon"][value="…"]`.
	 */
	let { value = $bindable<ThreadIcon>('envelope') }: { value?: ThreadIcon } = $props();
</script>

<fieldset>
	<legend>How it looks on their board</legend>
	<div class="grid">
		{#each THREAD_ICONS as icon (icon)}
			<!--
				The name comes from THREAD_ICON_LABELS rather than the icon's own
				name: "bottle-droplet" is a Font Awesome identifier, not something to
				read out. It is visually hidden rather than absent, so the control has
				a real accessible name and a test has something to match on.
			-->
			<label>
				<input type="radio" name="icon" value={icon} bind:group={value} />
				<span class="swatch">
					<wa-icon name={icon} variant="solid" canvas="square"></wa-icon>
				</span>
				<span class="name">{THREAD_ICON_LABELS[icon]}</span>
			</label>
		{/each}
	</div>
</fieldset>

<style>
	fieldset {
		border: none;
		margin: 0;
		padding: 0;

		legend {
			padding: 0 0 0.5rem;
			font-size: 0.8125rem;
			color: var(--wa-color-text-quiet);
		}
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.5rem;
	}

	label {
		display: grid;
		place-items: center;
		cursor: pointer;

		/*
		 * clip-path rather than display:none — a hidden-by-display radio drops out
		 * of the tab order, and this is the only control in the composer that
		 * cannot be reached any other way.
		 */
		input {
			position: absolute;
			clip-path: inset(50%);
			inline-size: 1px;
			block-size: 1px;
			overflow: hidden;
		}

		.swatch {
			display: grid;
			place-items: center;
			aspect-ratio: 1;
			inline-size: 100%;
			border-radius: var(--wa-panel-border-radius, 0.375rem);
			border: 2px solid transparent;
			background: var(--wa-color-neutral-fill-quiet, rgb(0 0 0 / 4%));
			color: var(--wa-color-text-quiet);

			wa-icon {
				font-size: 1.375rem;
			}
		}

		input:checked + .swatch {
			border-color: var(--wa-color-brand-fill-loud, currentColor);
			color: var(--wa-color-brand-fill-loud, currentColor);
		}

		input:focus-visible + .swatch {
			outline: 2px solid var(--wa-color-brand-fill-loud, currentColor);
			outline-offset: 2px;
		}

		/* Hidden from sight, not from the accessibility tree or from a locator.
		   clip-path rather than display:none for the same reason as the input. */
		.name {
			position: absolute;
			clip-path: inset(50%);
			inline-size: 1px;
			block-size: 1px;
			overflow: hidden;
			white-space: nowrap;
		}
	}
</style>
