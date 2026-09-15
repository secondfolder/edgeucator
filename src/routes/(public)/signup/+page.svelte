<script lang="ts">
	import { resolve } from '$app/paths';
	import SignupForm from '$lib/components/SignupForm.svelte';

	let { data } = $props();

	// svelte-ignore state_referenced_locally
	// Captures the load's initial `data` on purpose: this is a static property of
	// this render, and re-deriving it on every `invalidate()` changes nothing.
	// `redirectTo` was validated by `safeRedirect` in the load, so it is safe to
	// put straight back into a query string.
	const loginHref = data.redirectTo
		? `${resolve('/login')}?redirectTo=${encodeURIComponent(data.redirectTo)}`
		: resolve('/login');
</script>

<SignupForm data={data.signupForm} />

<!-- Not plain "Log in": the (public) header already has a link by that name,
     and two links with the same accessible name going to different places is a
     real problem for anyone navigating by link list (see AGENTS.md). -->
<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
<a class="cross-link" href={loginHref}>Already have an account? Log in</a>

<style>
	.cross-link {
		display: block;
		margin: 1rem auto 0;
		width: fit-content;
		color: var(--wa-color-text-quiet);
	}
</style>
