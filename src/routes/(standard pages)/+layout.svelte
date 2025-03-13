<script>
	let { children } = $props();
</script>



<svelte:head>
    <style>
        body {
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            min-height: 100svh;
        }
    </style>
</svelte:head>
<style>
    .container {
        --padding: 1em;
        max-width: calc(100svw - (var(--padding) * 1));
        width: 800px;
        padding: var(--padding);
        display: flex;
        flex-direction: column;
        flex: 1 1 auto;
    }
</style>
<div class="container">
    {@render children()}
</div>
