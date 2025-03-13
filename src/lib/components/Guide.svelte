<script lang="ts">
	import Task from "./Task.svelte";

	let { guide, tasks } = $props();
	let currentTaskIndex: number = $state(0);
	const increment = () => {
		currentTaskIndex += 1;
	};
    let currentTask = $derived(tasks[currentTaskIndex]);
</script>

<div>
    <h1>{guide.title}</h1>
    <!-- Task: {currentTaskIndex + 1} -->
    <Task task={currentTask} />
    <!-- <button onclick={increment}>
        Next
    </button> -->
</div>

<style>
    div {
        min-height: 100%;
        display: flex;
        flex-direction: column;
        
        h1 {
            text-align: center;
        }
    }
</style>

