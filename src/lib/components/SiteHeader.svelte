<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';

	// Server data is the source of truth — no context store, no client authStore.
	const user = $derived(page.data.user);
</script>

<nav>
	<div class="navbar-end">
		<ul class="menu menu-horizontal">
			{#if user}
				<li>{user.email}</li>
				<li><a href="/settings/passkeys">Passkeys</a></li>
				<li>
					<!-- Plain use:enhance is enough: its default behaviour already
					     does goto + invalidateAll for a redirect result. The old
					     callback existed only to clear pb.authStore. -->
					<form method="POST" action="/logout" use:enhance>
						<button>Log out</button>
					</form>
				</li>
			{:else}
				<li><a href="/login">Login</a></li>
				<li><a href="/signup">Sign up</a></li>
			{/if}
		</ul>
	</div>
</nav>

<style>
	nav {
		width: 100%;
		display: flex;
		justify-content: flex-end;
		padding: 1rem;
		background-color: var(--wa-color-surface);
		border-bottom: 1px solid var(--wa-color-surface-border);

		ul {
			margin: 0;
			display: flex;
			gap: 1rem;
			flex-wrap: wrap;
			align-items: center;

			li {
				margin: 0;
				list-style-type: none;
			}
		}
	}
</style>
