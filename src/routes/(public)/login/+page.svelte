<script lang="ts">
	import LoginForm from '$lib/components/LoginForm.svelte';

	let { data } = $props();
</script>

<LoginForm data={data.loginForm} />
