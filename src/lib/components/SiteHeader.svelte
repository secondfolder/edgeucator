<script lang="ts">
	import { applyAction, enhance } from '$app/forms';
	import { pb } from '$lib/pocketbase';
	import { getUserContext } from '$lib/contexts/user';

	const user = getUserContext();
</script>

<nav>
	<div class="navbar-end">
		<ul class="menu menu-horizontal">
			{#if $user}
				<li>{$user.email}</li>
				<li>
					<form
						method="POST"
						action="/logout"
						use:enhance={() => {
							return async ({ result }) => {
								pb.authStore.clear();
								await applyAction(result);
							};
						}}
					>
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
