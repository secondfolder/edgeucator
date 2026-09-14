<script lang="ts">
	import Guide from '$lib/components/Guide.svelte';

	let { data } = $props();
	let { guide, edgeTasks } = $derived(data);
</script>

<div class="page">
	<Guide {guide} {edgeTasks} />
</div>

<style>
	.page {
		background-color: var(--wa-color-surface-default);
		/* Was `max-height: 100%`, which capped the box while its content kept
		   growing and left EdgeTask's sticky footer with nothing to stick inside.
		   min-height fills a short guide without fighting a long one. */
		min-height: 100%;
		max-width: 800px;
		margin-inline: auto;
		padding: 0 1em;

		display: flex;
		flex-direction: column;
	}
</style>
