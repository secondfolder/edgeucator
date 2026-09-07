<script lang="ts">
	import { resolve } from '$app/paths';
	import type { GuideView } from '$lib/types';

	let { guides }: { guides: GuideView[] } = $props();
</script>

<ul>
	{#each guides as guide (guide.id)}
		<li>
			<a href={resolve('/(auth-required)/(app)/home/guides/[id]', { id: guide.id })}
				>{guide.title}</a
			>
		</li>
	{/each}
</ul>

<style>
	ul {
		list-style-type: none;
		margin-left: 0;

		display: flex;
		flex-direction: row;
		gap: 1rem;
	}
</style>
