<script lang="ts">
	import GuidesList from '$lib/components/GuidesList.svelte';

	let { data } = $props();
	let { guides } = $derived(data);
</script>

<h1>Guides</h1>
<GuidesList {guides} />

<style>
	h1 {
		text-align: center;
	}
</style>
