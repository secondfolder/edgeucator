<script lang="ts" module>
	type T = Record<string, unknown>;
</script>

<script lang="ts" generics="T extends Record<string, unknown>">
	import { formFieldProxy, type SuperForm, type FormPathLeaves } from 'sveltekit-superforms';

	let {
		superform,
		field,
		title,
        type,
		...otherProps
	}: { superform: SuperForm<T>; field: FormPathLeaves<T>; title?: string; type: string } = $props();

	const { errors, constraints } = formFieldProxy(superform, field);
</script>

<div class="field">
    {#if type === 'password'}
        <wa-input
            label={title || field}
            name={field}
            type={type}
            password-toggle
            aria-invalid={$errors ? 'true' : undefined}
            {...$constraints}
            {...otherProps}
        ></wa-input>
    {:else if type === 'email' || type === 'text'}
        <wa-input
            label={title || field}
            name={field}
            type={type}
            {...$constraints}
            {...otherProps}
        ></wa-input>
    {:else}
        {`Unsupported type: ${type}`}
    {/if}
    {#if $errors}<span class="invalid">{$errors}</span>{/if}
</div>


<style>
	.field {
        .invalid {
            color: var(--wa-color-text-danger);
        }
	}
</style>