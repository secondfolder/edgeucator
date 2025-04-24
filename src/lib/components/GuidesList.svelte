<script lang="ts">
	let { guides } = $props();
</script>

<ul>
	{#each guides as guide}
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
