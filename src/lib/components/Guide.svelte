<script lang="ts">
	import type { GuideView, TaskView } from '$lib/types';
	import Task from './Task.svelte';

	interface Props {
		guide: GuideView;
		tasks: TaskView[];
	}

	let { guide, tasks }: Props = $props();
	let currentTaskIndex: number = $state(0);
	let currentTask = $derived(tasks[currentTaskIndex]);
</script>

<div>
	<h1>{guide.title}</h1>
	<!-- Task: {currentTaskIndex + 1} -->
	{#if currentTask}
		<Task task={currentTask} />
	{:else}
		<p class="empty">This guide has no tasks yet.</p>
	{/if}
	<!-- Next button intentionally still absent; see the note in the plan about
	     there being no per-user progress persistence yet. -->
</div>

<style>
	div {
		/* Was `min-height: 100%`. That percentage resolves against a parent with a
		   specified height, and the page wrapper only has a min-height, so it fell
		   back to auto and left Task's sticky footer floating mid-page instead of
		   pinned above the nav. Stretching as a flex item does not depend on the
		   parent having a resolvable height. */
		flex: 1 1 auto;
		display: flex;
		flex-direction: column;

		h1 {
			text-align: center;
		}

		.empty {
			text-align: center;
			color: var(--wa-color-text-quiet);
		}
	}
</style>
