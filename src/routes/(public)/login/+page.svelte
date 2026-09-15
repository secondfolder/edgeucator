<script lang="ts">
	import { resolve } from '$app/paths';
	import LoginForm from '$lib/components/LoginForm.svelte';

	let { data } = $props();

	// svelte-ignore state_referenced_locally
	// Captures the load's initial `data` on purpose: this is a static property of
	// this render, and re-deriving it on every `invalidate()` changes nothing.
	// `redirectTo` was validated by `safeRedirect` in the load, so it is safe to
	// put straight back into a query string.
	const signupHref = data.redirectTo
		? `${resolve('/signup')}?redirectTo=${encodeURIComponent(data.redirectTo)}`
		: resolve('/signup');
</script>

<LoginForm data={data.loginForm} redirectTo={data.redirectTo} />

<!-- Not plain "Sign up": the (public) header already has a link by that name,
     and two links with the same accessible name going to different places is a
     real problem for anyone navigating by link list (see AGENTS.md). -->
<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
<a class="cross-link" href={signupHref}>New here? Create an account</a>

<style>
	.cross-link {
		display: block;
		margin: 1rem auto 0;
		width: fit-content;
		color: var(--wa-color-text-quiet);
	}
</style>
