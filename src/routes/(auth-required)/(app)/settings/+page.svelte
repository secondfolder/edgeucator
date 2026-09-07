<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

	// Server load data is the single source of truth for auth state — see the
	// note in src/routes/+layout.svelte.
	const user = $derived(page.data.user);
</script>

<section>
	<h1>Settings</h1>

	{#if user}
		<div class="account">
			<span class="name">{user.name}</span>
			<span class="email">{user.email}</span>
		</div>
	{/if}

	<ul>
		<li>
			<a href={resolve('/(auth-required)/(app)/settings/passkeys')}>
				<span>Passkeys</span>
				<wa-icon name="chevron-right" variant="solid"></wa-icon>
			</a>
		</li>
	</ul>

	<!-- Plain use:enhance is enough: its default behaviour already does goto +
	     invalidateAll for a redirect result. -->
	<form method="POST" action="/logout" use:enhance>
		<wa-button type="submit" appearance="outlined" variant="danger">Log out</wa-button>
	</form>
</section>

<style>
	section {
		max-width: 40rem;
		margin: 0 auto;
		padding: var(--wa-space-l);

		h1 {
			margin-top: 0;
		}

		.account {
			display: flex;
			flex-direction: column;

			.name {
				font-weight: var(--wa-font-weight-semibold, 600);
			}

			.email {
				color: var(--wa-color-text-quiet);
			}
		}

		ul {
			padding: 0;
			margin: var(--wa-space-l) 0;

			li {
				list-style-type: none;
				border-bottom: 1px solid var(--wa-color-surface-border);

				a {
					display: flex;
					align-items: center;
					justify-content: space-between;
					gap: 1rem;
					padding: 0.75rem 0;
					text-decoration: none;
					color: inherit;
				}
			}
		}
	}
</style>
