<script lang="ts">
	import Guide from '$lib/components/Guide.svelte';

	let { data } = $props();
	let { guide, tasks } = $derived(data);
</script>

<div>
	<Guide {guide} {tasks} />
</div>

<style>
	div {
		background-color: var(--wa-color-surface-default);
		max-height: 100%;
		width: 100%;
	}
</style>
