<script lang="ts">
	import GuidesList from '$lib/components/GuidesList.svelte';

	let { data } = $props();
	let { guides } = $derived(data);
</script>

<div class="page">
	<h1>Guides</h1>
	<GuidesList {guides} />
</div>

<style>
	/* The 800px column used to come from the (public) layout. Inside the app
	   shell <main> is the full-width scroll container, so the page carries it. */
	.page {
		max-width: 800px;
		margin-inline: auto;
		padding: 1em;

		h1 {
			text-align: center;
		}
	}
</style>
