<script lang="ts">
	import { scorePassword } from '$lib/password-strength';

	/**
	 * A password box whose value never leaves the browser.
	 *
	 * Its own component rather than a mode of `InputField.svelte` for one
	 * reason, and it is the whole point of the file: `InputField` sets
	 * `name={field}` unconditionally, and an input with a `name` is in the
	 * submitted FormData whether or not any JavaScript ran. A name here would
	 * be one thrown exception away from posting the plaintext password to the
	 * server, which is exactly what this design exists to prevent.
	 *
	 * So there is no `name`, deliberately and permanently, and the value is
	 * read through `bind:value` into a plain local rather than into superforms'
	 * `$form`. `$form` is what `onUpdated` echoes back and what a stray
	 * `console.log` would print — two of those were removed from this codebase
	 * already, for precisely that reason.
	 */
	let {
		value = $bindable(''),
		label,
		autocomplete,
		field,
		/** Show a strength meter. On for setting a password, off for entering one. */
		strength = false,
		errors = undefined
	}: {
		value?: string;
		label: string;
		autocomplete: 'current-password' | 'new-password';
		/** Only for test locators — see the comment on the attribute below. */
		field: string;
		strength?: boolean;
		errors?: string[] | undefined;
	} = $props();

	const score = $derived(strength ? scorePassword(value) : null);

	function onInput(event: Event) {
		// Not `bind:value` on the element: <wa-input> is a custom element, so
		// Svelte cannot know it has a `value` property until Web Awesome upgrades
		// it, and the binding silently does nothing until then. Same reason
		// InputField.svelte reads its value this way.
		value = (event.target as HTMLInputElement | null)?.value ?? '';
	}
</script>

<div class="field">
	<!--
		`data-field` rather than `name`: the Playwright suite has to be able to
		find this box, and `getByLabel('Password')` is ambiguous against
		"Confirm password". A data attribute is not submitted, which is the
		difference that matters.
	-->
	<wa-input
		{label}
		type="password"
		{autocomplete}
		data-field={field}
		{value}
		oninput={onInput}
		password-toggle
		aria-invalid={errors ? 'true' : undefined}
		aria-describedby={score?.hint && !errors ? `${field}-hint` : undefined}
	></wa-input>

	<!--
		The hint is suppressed while an error is showing. They often say the same
		sentence — "Use at least 12 characters" is both the live hint and the
		refusal — and rendering it twice, stacked, reads as a glitch. The error is
		the more urgent framing, so it wins.
	-->
	{#if score && value.length > 0 && !errors}
		<div class="strength" aria-hidden="true">
			{#each [0, 1, 2, 3] as step (step)}
				<span class="bar" class:filled={score.score > step} data-score={score.score}></span>
			{/each}
		</div>
		{#if score.hint}
			<span class="hint" id="{field}-hint">{score.hint}</span>
		{/if}
	{/if}

	{#if errors}<span class="invalid">{errors}</span>{/if}
</div>

<style>
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;

		.strength {
			display: flex;
			gap: 0.25rem;

			.bar {
				flex: 1 1 0;
				block-size: 0.25rem;
				border-radius: 0.125rem;
				background-color: var(--wa-color-surface-border);

				&.filled {
					background-color: var(--wa-color-warning-fill-loud, var(--wa-color-yellow-50));
				}

				/* Only the top score reads as "done"; everything else stays amber so
				   a two-bar password does not look approved. */
				&.filled[data-score='4'] {
					background-color: var(--wa-color-success-fill-loud, var(--wa-color-green-50));
				}

				&.filled[data-score='0'],
				&.filled[data-score='1'] {
					background-color: var(--wa-color-text-danger);
				}
			}
		}

		.hint,
		.invalid {
			font-size: 0.8125rem;
		}

		.hint {
			color: var(--wa-color-text-quiet);
		}

		.invalid {
			color: var(--wa-color-text-danger);
		}
	}
</style>
