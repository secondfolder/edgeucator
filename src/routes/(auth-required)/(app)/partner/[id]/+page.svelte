<script lang="ts">
	import { resolve } from '$app/paths';
	import { initialsFor } from '$lib/initials';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let partner = $derived(data.partner);
</script>

<section>
	<header>
		<wa-avatar
			image={partner.image ?? undefined}
			initials={initialsFor(partner.name)}
			label={partner.name}
		></wa-avatar>
		<h1>{partner.name}</h1>
		{#if partner.relationshipLabel}
			<p class="label">{partner.relationshipLabel}</p>
		{/if}
	</header>

	<p>They call you <strong>{partner.yourName}</strong>.</p>

	<p class="todo">
		Shared guides and progress are not built yet. For now this page is where the link between the
		two of you lives.
	</p>

	<a href={resolve('/(auth-required)/(app)/settings/partners/[id]', { id: partner.id })}>
		{partner.canEdit ? 'Edit this connection' : 'Connection settings'}
	</a>
</section>

<style>
	section {
		max-width: 40rem;
		margin: 0 auto;
		padding: var(--wa-space-l);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		text-align: center;

		header {
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: 0.75rem;

			wa-avatar {
				--size: 5rem;
			}

			h1 {
				margin: 0;
			}

			.label {
				margin: 0;
				color: var(--wa-color-text-quiet);
			}
		}

		p {
			margin: 0;
		}

		.todo {
			color: var(--wa-color-text-quiet);
		}
	}
</style>
