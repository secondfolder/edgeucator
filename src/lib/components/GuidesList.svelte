<script lang="ts">
	import type { GuideView } from '$lib/types';

	let { guides }: { guides: GuideView[] } = $props();
</script>

<ul>
	{#each guides as guide (guide.id)}
		<li>
			<a href="/guides/{guide.id}">{guide.title}</a>
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
