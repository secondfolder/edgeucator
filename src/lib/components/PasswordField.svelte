<script lang="ts">
	import { onMount } from 'svelte';
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

	/**
	 * The `<wa-input>` element itself.
	 *
	 * `bind:this` rather than `bind:value`: it is a custom element, so Svelte
	 * cannot know it has a `value` property until Web Awesome upgrades it, and
	 * the binding silently does nothing until then. Same reason
	 * `InputField.svelte` reads its value the long way round.
	 */
	type WaInput = HTMLElement & {
		/**
		 * The native control the element renders inside its shadow root. Declared
		 * on `WaInput` in Web Awesome's own types, so reading it is using the
		 * element's API rather than reaching past it.
		 */
		input?: HTMLInputElement | null;
		/** Lit's "the render you just triggered has landed". */
		updateComplete?: Promise<unknown>;
	};
	let host: WaInput | undefined = undefined;

	/**
	 * Copies the control's value into our state.
	 *
	 * Reads the *element*, never `event.target.value`, and that is the whole
	 * correction: an event is only evidence that a value changed, and a password
	 * manager can change one without producing an event this component can see.
	 * The control is the only thing that is always right — after a fill that
	 * dispatches nothing at all, even the host's own `value` property is stale.
	 */
	function sync() {
		const control = host?.input;
		// No control means Web Awesome has not upgraded the element, so there is
		// nothing anyone could have put in it and nothing authoritative to read.
		// (Also the jsdom case, where `wa-*` never upgrades — so a component test
		// can never have its value silently blanked by this.)
		if (!control) return;
		if (control.value !== value) value = control.value;
	}

	onMount(() => {
		const controller = new AbortController();
		const { signal } = controller;

		/**
		 * A submit is the moment the value is actually used, so it is where
		 * correctness gets guaranteed rather than hoped for. Without this, being
		 * right depends on having observed every possible write to the input,
		 * which is not a list this component can close.
		 *
		 * On `document`, in the capture phase, which is what makes the ordering
		 * sound: capture descends window → document → … → form, so this always
		 * runs before the form's own handler, whether that is
		 * `use:superform.enhance` or a plain `onsubmit`. Registering it on the
		 * form would NOT be safe — listeners on an event's own target run in
		 * registration order regardless of the capture flag.
		 *
		 * `bind:value` writes propagate synchronously, so the parent's variable
		 * is already correct by the time its own submit handler reads it.
		 */
		document.addEventListener(
			'submit',
			(event) => {
				if (event.target === host?.closest('form')) sync();
			},
			{ capture: true, signal }
		);

		void (async () => {
			// The shadow root, and so the control, only exist after the upgrade.
			await customElements.whenDefined('wa-input');
			await host?.updateComplete;
			if (signal.aborted) return;

			/**
			 * `addEventListener` on the inner control as well as the host, rather
			 * than an `oninput=` attribute on the host alone.
			 *
			 * This is the bug that produced this file's current shape. Svelte 5
			 * delegates `input` from a single listener at the root, and delegation
			 * cannot see an event that never reaches the root. A password manager
			 * extension fills a field by assigning `input.value` and dispatching
			 * `new Event('input', { bubbles: true })` — which defaults to
			 * `composed: false`, so it bubbles *within* the shadow root, updating
			 * `<wa-input>`'s own value on the way, and then stops dead at the
			 * boundary. The host handler never ran, our state stayed empty, and
			 * signing up was refused for a password under 12 characters while a
			 * 21-character one sat visible in the box.
			 *
			 * Real typing and Chrome's own autofill send trusted, composed events
			 * and always worked, which is why this only ever reproduced with an
			 * extension installed.
			 */
			for (const target of [host, host?.input]) {
				if (!target) continue;
				target.addEventListener('input', sync, { signal });
				target.addEventListener('change', sync, { signal });
			}

			// A manager may have filled the box before the element upgraded, which
			// would make every listener above too late.
			sync();
		})();

		return () => controller.abort();
	});
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
		bind:this={host}
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
