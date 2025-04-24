<script lang="ts">
	import Guide from '$lib/components/Guide.svelte';

	let { data } = $props();
	let { guide } = $derived(data);
</script>

<div>
    <Guide guide={guide} tasks={guide?.expand?.tasks_via_guide_id} />
</div>

<style>
    div {
        background-color: var(--wa-color-surface-default);
        max-height: 100%;
        width: 100%;
    }
</style>