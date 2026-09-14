<script lang="ts" module>
	type T = Record<string, unknown>;
</script>

<script lang="ts" generics="T extends Record<string, unknown>">
	import { formFieldProxy, type SuperForm, type FormPathLeaves } from 'sveltekit-superforms';

	let {
		superform,
		field,
		title,
		startText = null,
		type,
		...otherProps
	}: {
		superform: SuperForm<T>;
		field: FormPathLeaves<T>;
		title?: string;
		startText?: string | null;
		type: string;
		// Any further attributes are spread onto the underlying <wa-input>, which
		// is how callers pass things like `autocomplete`.
		[attribute: string]: unknown;
	} = $props();

	// svelte-ignore state_referenced_locally
	// Captures the initial `superform`/`field` on purpose: the proxies it
	// returns are the live stores, so re-deriving them per render would
	// rebuild every field's subscription instead.
	const { value, errors, constraints } = formFieldProxy(superform, field);

	/**
	 * `pattern` is stripped before the constraints reach the element.
	 *
	 * Zod's `z.email()` default regex arrives here as superforms' `pattern`
	 * constraint, and Chromium compiles pattern attributes with the `v` flag —
	 * under which that regex is invalid ("invalid character in class"), so the
	 * browser logged an error and ignored the constraint on every login and
	 * signup page load. Nothing is lost by dropping it: `type="email"` does the
	 * native check and the server action re-validates with Zod, which is the
	 * authoritative gate anyway.
	 */
	const attributes = $derived.by(() => {
		const rest = { ...$constraints };
		delete rest.pattern;
		return rest;
	});

	/**
	 * The field is rendered FROM `$value` and writes back to it on input.
	 *
	 * Without this the input had no `value` at all: fine for login and signup,
	 * whose fields start empty and are read from the posted FormData, but every
	 * prefilled form (editing a partner, confirming an invite) rendered blank
	 * and then posted those blanks back. It also means `$form` now tracks what
	 * the user typed, which is what superforms' client-side validation and
	 * `tainted` tracking need.
	 *
	 * `bind:value` is deliberately not used: <wa-input> is a custom element, so
	 * Svelte cannot know it has a value property until the CDN bundle upgrades
	 * it, and the binding silently does nothing until then.
	 */
	function onInput(event: Event) {
		const target = event.target as HTMLInputElement | null;
		// `as` because the proxy is typed to the field's own type; every input
		// this component renders is a string field.
		$value = (target?.value ?? '') as typeof $value;
	}

	// null is a legitimate stored value (an omitted relationship label), but it
	// would render as the literal string "null".
	const displayValue = $derived($value == null ? '' : String($value));
</script>

<div class="field">
	{#if type === 'password'}
		<wa-input
			label={title || field}
			name={field}
			{type}
			value={displayValue}
			oninput={onInput}
			password-toggle
			aria-invalid={$errors ? 'true' : undefined}
			{...attributes}
			{...otherProps}
		>
			{#if startText}<span slot="start" class="start-text">{startText}</span>{/if}
		</wa-input>
	{:else if type === 'email' || type === 'text'}
		<wa-input
			label={title || field}
			name={field}
			{type}
			value={displayValue}
			oninput={onInput}
			aria-invalid={$errors ? 'true' : undefined}
			{...attributes}
			{...otherProps}
		>
			{#if startText}<span slot="start" class="start-text">{startText}</span>{/if}
		</wa-input>
	{:else}
		{`Unsupported type: ${type}`}
	{/if}
	{#if $errors}<span class="invalid">{$errors}</span>{/if}
</div>

<style>
	.field {
		.start-text {
			color: var(--wa-color-text-quiet);
			white-space: nowrap;
			margin-inline-end: 0.35rem;
		}

		.invalid {
			color: var(--wa-color-text-danger);
		}
	}
</style>
