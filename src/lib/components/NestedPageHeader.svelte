<script lang="ts">
	let {
		backHref,
		backLabel,
		backText,
		title = null,
		description = null
	}: {
		backHref: string;
		backLabel: string;
		backText: string;
		title?: string | null;
		description?: string | null;
	} = $props();
</script>

<header>
	<div class="top">
		<!--
			The visible back text is often the parent page's title rather than the
			link's accessible name, because two nested links must not collide in a
			link list just because they happen to point back toward the same screen.

			`backHref` is resolved by the caller. This component takes a runtime
			string so it can be reused from different route depths, and there is no
			route id for eslint to resolve against here.
		-->
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
		<a href={backHref} aria-label={backLabel}>
			<wa-icon name="chevron-left" variant="solid"></wa-icon>
			<span>{backText}</span>
		</a>
	</div>

	{#if title || description}
		<div class="copy">
			{#if title}<h1>{title}</h1>{/if}
			{#if description}<p>{description}</p>{/if}
		</div>
	{/if}
</header>

<style>
	header {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: var(--wa-space-s) var(--wa-space-m);
		border-block-end: 1px solid var(--wa-color-surface-border);
	}

	.top {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	a {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		min-inline-size: 0;
		text-decoration: none;
		color: inherit;
		font-weight: var(--wa-font-weight-semibold, 600);
	}

	.copy {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;

		h1,
		p {
			margin: 0;
		}

		p {
			color: var(--wa-color-text-quiet);
		}
	}
</style>
