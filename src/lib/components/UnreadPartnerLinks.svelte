<script lang="ts">
	import { resolve } from '$app/paths';
	import { initialsFor } from '$lib/initials';
	import type { UnreadPartnerView } from '$lib/types';

	/** One link per partner with something waiting. Nothing at all otherwise. */
	let { unread }: { unread: UnreadPartnerView[] } = $props();
</script>

{#if unread.length > 0}
	<ul>
		{#each unread as partner (partner.partnershipId)}
			<li>
				<!--
					The accessible name has to be distinct from the AppNav tab for the
					same partner, which is just their name — two links sharing a name is
					a real problem for anyone navigating by link list, and it makes a
					test locator ambiguous. Hence the count and the word "new".
				-->
				<a
					href={resolve('/(auth-required)/(app)/partner/[id]/messages', {
						id: partner.partnershipId
					})}
				>
					<wa-avatar
						image={partner.image ?? undefined}
						initials={initialsFor(partner.name)}
						label={partner.name}
					></wa-avatar>
					<span class="what">
						{partner.unreadThreads} new message{partner.unreadThreads === 1 ? '' : 's'} from
						{partner.name}
					</span>
					<wa-icon name="chevron-right" variant="solid"></wa-icon>
				</a>
			</li>
		{/each}
	</ul>
{/if}

<style>
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		inline-size: 100%;
		max-inline-size: 22rem;

		a {
			display: flex;
			align-items: center;
			gap: 0.625rem;
			padding: 0.625rem 0.75rem;
			border-radius: var(--wa-panel-border-radius, 0.5rem);
			border: 1px solid var(--wa-color-surface-border);
			background-color: var(--wa-color-brand-fill-quiet, transparent);
			text-decoration: none;
			color: inherit;
			-webkit-tap-highlight-color: transparent;

			wa-avatar {
				--size: 2rem;
				flex: none;
			}

			.what {
				flex: 1 1 auto;
				min-inline-size: 0;
				font-size: 0.9375rem;
			}

			wa-icon {
				color: var(--wa-color-text-quiet);
				flex: none;
			}
		}
	}
</style>
