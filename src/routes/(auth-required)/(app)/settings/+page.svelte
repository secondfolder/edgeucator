<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Server load data is the single source of truth for auth state — see the
	// note in src/routes/+layout.svelte.
	const user = $derived(page.data.user);
	const hasMessageHistory = $derived(data.hasMessageHistory);
</script>

<section>
	<h1>Settings</h1>

	{#if user}
		<div class="account">
			<div class="account-row">
				<div class="account-copy">
					<span class="eyebrow">Signed in as</span>
					<span class="name">{user.name}</span>
					<span class="email">{user.email}</span>
				</div>

				<!-- Plain use:enhance is enough: its default behaviour already does goto +
				     invalidateAll for a redirect result. -->
				<form method="POST" action="/logout" use:enhance>
					<wa-button type="submit" appearance="outlined" variant="danger">Log out</wa-button>
				</form>
			</div>
		</div>
	{/if}

	<ul>
		<li>
			<a href={resolve('/(auth-required)/(app)/settings/account')}>
				<span>Account</span>
				<wa-icon name="chevron-right" variant="solid"></wa-icon>
			</a>
		</li>
		<li>
			<a href={resolve('/(auth-required)/(app)/settings/security')}>
				<span>Security</span>
				<wa-icon name="chevron-right" variant="solid"></wa-icon>
			</a>
		</li>
		<li>
			<a href={resolve('/(auth-required)/(app)/settings/partners')}>
				<span>Partners</span>
				<wa-icon name="chevron-right" variant="solid"></wa-icon>
			</a>
		</li>
		{#if hasMessageHistory}
			<li>
				<a href={resolve('/(auth-required)/(app)/settings/encryption')}>
					<span>Encrypted messages</span>
					<wa-icon name="chevron-right" variant="solid"></wa-icon>
				</a>
			</li>
		{/if}
	</ul>
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
			padding: 0.875rem 1rem;
			border: 1px solid var(--wa-color-surface-border);
			border-radius: var(--wa-border-radius-l);
			background: var(--wa-color-surface-raised);
			margin-bottom: var(--wa-space-l);

			.account-row {
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 1rem;
				flex-wrap: wrap;
			}

			.account-copy {
				display: flex;
				flex-direction: column;
				gap: 0.125rem;
				min-width: 0;
			}

			.eyebrow {
				font-size: var(--wa-font-size-s);
				color: var(--wa-color-text-quiet);
			}

			.name {
				font-weight: var(--wa-font-weight-semibold, 600);
			}

			.email {
				color: var(--wa-color-text-quiet);
			}

			form {
				margin-left: auto;
			}
		}

		ul {
			padding: 0;
			margin: 0;

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
