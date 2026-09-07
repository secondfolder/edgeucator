<script lang="ts">
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
	</header>

	<p>
		Partners are not built yet — this page exists so the shape of the app is in place. Nothing here
		is stored against your account.
	</p>
</section>

<style>
	section {
		max-width: 40rem;
		margin: 0 auto;
		padding: var(--wa-space-l);

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
		}

		p {
			color: var(--wa-color-text-quiet);
			text-align: center;
		}
	}
</style>
