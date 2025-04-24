<script lang="ts">
	import SignupForm from "$lib/components/SignupForm.svelte";
    
    let { data } = $props();
</script>

<SignupForm data={data.signupForm} />