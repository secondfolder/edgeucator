<script lang="ts">
	import { resolve } from '$app/paths';
	import { initialsFor } from '$lib/initials';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const pending = $derived(data.partnerships.filter((p) => p.status === 'pending'));
	const accepted = $derived(data.partnerships.filter((p) => p.status === 'accepted'));
</script>

<section>
	<header>
		<h1>Partners</h1>
		<wa-button href={resolve('/(auth-required)/(app)/settings/partners/new')} size="s">
			<wa-icon slot="start" name="plus" variant="solid"></wa-icon>
			Add
		</wa-button>
	</header>

	<p class="intro">
		Linking with a partner lets the two of you see each other in the app. You choose what you call
		each other and who can change those settings.
	</p>

	{#if accepted.length === 0 && pending.length === 0}
		<p class="empty">You have no partners yet.</p>
	{/if}

	{#if accepted.length > 0}
		<h2>Linked</h2>
		<ul>
			{#each accepted as partnership (partnership.id)}
				<li>
					<a
						href={resolve('/(auth-required)/(app)/settings/partners/[id]', { id: partnership.id })}
					>
						<wa-avatar
							image={partnership.counterpart?.image ?? undefined}
							initials={initialsFor(partnership.partnerName)}
							label={partnership.partnerName}
						></wa-avatar>
						<span class="who">
							{partnership.partnerName}
							{#if partnership.relationshipLabel}
								<small>{partnership.relationshipLabel}</small>
							{/if}
						</span>
						<wa-icon name="chevron-right" variant="solid"></wa-icon>
					</a>
				</li>
			{/each}
		</ul>
	{/if}

	{#if pending.length > 0}
		<h2>Pending</h2>
		<ul>
			{#each pending as partnership (partnership.id)}
				<li>
					<a
						href={resolve('/(auth-required)/(app)/settings/partners/[id]', { id: partnership.id })}
					>
						<wa-avatar
							initials={initialsFor(partnership.partnerName)}
							label={partnership.partnerName}
						></wa-avatar>
						<span class="who">
							{partnership.partnerName}
							<small>Waiting for them to accept</small>
						</span>
						<wa-icon name="chevron-right" variant="solid"></wa-icon>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	section {
		max-width: 40rem;
		margin: 0 auto;
		padding: var(--wa-space-l);

		header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 1rem;

			h1 {
				margin: 0;
			}
		}

		.intro,
		.empty {
			color: var(--wa-color-text-quiet);
		}

		h2 {
			font-size: 1rem;
			margin-bottom: 0.25rem;
		}

		ul {
			padding: 0;
			margin: 0 0 var(--wa-space-l);

			li {
				list-style-type: none;
				border-bottom: 1px solid var(--wa-color-surface-border);

				a {
					display: flex;
					align-items: center;
					gap: 0.75rem;
					padding: 0.75rem 0;
					text-decoration: none;
					color: inherit;

					wa-avatar {
						--size: 2.25rem;
						flex: 0 0 auto;
					}

					.who {
						flex: 1 1 auto;
						min-width: 0;

						small {
							display: block;
							color: var(--wa-color-text-quiet);
						}
					}
				}
			}
		}
	}
</style>
