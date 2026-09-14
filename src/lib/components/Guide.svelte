<script lang="ts">
	import type { EdgeTaskView, GuideView } from '$lib/types';
	import EdgeTask from './EdgeTask.svelte';

	interface Props {
		guide: GuideView;
		edgeTasks: EdgeTaskView[];
	}

	let { guide, edgeTasks }: Props = $props();
	let currentEdgeTaskIndex: number = $state(0);
	let currentEdgeTask = $derived(edgeTasks[currentEdgeTaskIndex]);
</script>

<div>
	<h1>{guide.title}</h1>
	<!-- Edge task: {currentEdgeTaskIndex + 1} -->
	{#if currentEdgeTask}
		<EdgeTask edgeTask={currentEdgeTask} />
	{:else}
		<p class="empty">This guide has no edge tasks yet.</p>
	{/if}
	<!-- Next button intentionally still absent; see the note in the plan about
	     there being no per-user progress persistence yet. -->
</div>

<style>
	div {
		/* Was `min-height: 100%`. That percentage resolves against a parent with a
		   specified height, and the page wrapper only has a min-height, so it fell
		   back to auto and left EdgeTask's sticky footer floating mid-page instead of
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
