<script lang="ts">
	import { invalidate } from '$app/navigation';
	import type { EventHandler } from 'svelte/elements';

	import type { PageData } from './$types';
	import Task from '$lib/components/Task.svelte';
	import Guide from '$lib/components/Guide.svelte';

	let { data } = $props();
	let { guide, tasks, supabase, user } = $derived(data);

</script>

<div>
    <Guide guide={guide} tasks={tasks} />
</div>

<style>
    div {
        background-color: var(--wa-color-surface-default);
        max-height: 100%;
        width: 100%;
    }
</style>