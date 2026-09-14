<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { initialsFor } from '$lib/initials';
	import type { PartnerView } from '$lib/types';

	let { partners }: { partners: PartnerView[] } = $props();

	const homeHref = resolve('/(auth-required)/(app)/home');
	const settingsHref = resolve('/(auth-required)/(app)/settings');

	// The active tab is decided on `page.route.id`, NOT on a pathname compared
	// against resolve()'s output: during SSR resolve() returns a path relative
	// to the page being rendered ('./home', '../home'), which never equals
	// page.url.pathname, so the highlight was missing until hydration.
	const routeId = $derived(page.route.id);
	// Both tabs own child routes (/home/guides, /settings/security) and stay lit
	// while you are inside them, so these are prefix matches rather than equality.
	const isHome = $derived(routeId?.startsWith('/(auth-required)/(app)/home') ?? false);
	const isSettings = $derived(routeId?.startsWith('/(auth-required)/(app)/settings') ?? false);
	// A prefix match, like isHome and isSettings above: the partner tab owns
	// child routes now (/partner/[id]/messages and the threads under it) and an
	// exact match would make the tab go dark the moment you opened a message.
	const isPartner = $derived(
		(id: string) =>
			(routeId?.startsWith('/(auth-required)/(app)/partner/[id]') ?? false) && page.params.id === id
	);
</script>

<nav aria-label="Primary">
	<a href={homeHref} aria-current={isHome ? 'page' : undefined}>
		<wa-icon name="house" variant="solid"></wa-icon>
		<span>Home</span>
	</a>

	{#each partners as partner (partner.id)}
		{@const href = resolve('/(auth-required)/(app)/partner/[id]', { id: partner.id })}
		<a {href} aria-current={isPartner(partner.id) ? 'page' : undefined}>
			<!-- `image` is left off entirely when null: wa-avatar falls back to
			     initials, and an empty image="" would render a broken image. -->
			<wa-avatar
				image={partner.image ?? undefined}
				initials={initialsFor(partner.name)}
				label={partner.name}
			></wa-avatar>
			<span>{partner.name}</span>
		</a>
	{/each}

	<a href={settingsHref} aria-current={isSettings ? 'page' : undefined}>
		<wa-icon name="gear" variant="solid"></wa-icon>
		<span>Settings</span>
	</a>
</nav>

<style>
	nav {
		display: flex;
		justify-content: space-around;
		align-items: stretch;
		gap: 0.25rem;

		background-color: var(--wa-color-surface-raised, var(--wa-color-surface));
		border-top: 1px solid var(--wa-color-surface-border);
		/* Home-indicator gutter on iOS; 0 everywhere else. */
		padding-bottom: env(safe-area-inset-bottom, 0);

		a {
			flex: 1 1 0;
			min-width: 0;
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: 0.25rem;
			padding: 0.5rem 0.25rem;

			text-decoration: none;
			color: var(--wa-color-text-quiet);
			/* Kills the grey flash on tap that makes a web nav feel non-native. */
			-webkit-tap-highlight-color: transparent;

			wa-icon {
				font-size: 1.5rem;
			}

			wa-avatar {
				--size: 1.75rem;
			}

			&[aria-current='page'] wa-avatar {
				/* The blue label alone is easy to miss next to a photo, so the
				   active partner also gets a ring. */
				outline: 2px solid currentColor;
				outline-offset: 2px;
			}

			span {
				font-size: 0.7rem;
				line-height: 1;
				max-width: 100%;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			&[aria-current='page'] {
				color: var(--wa-color-brand-fill-loud, var(--wa-color-text-link));
			}
		}
	}
</style>
