<script lang="ts">
	import { superForm, type Infer, type SuperValidated } from 'sveltekit-superforms';
	import type { AccountFormSchema } from '$lib/schemas/accountForm';
	import TimezoneSelect from './TimezoneSelect.svelte';

	let {
		data,
		deviceTimezone = null
	}: {
		data: SuperValidated<Infer<AccountFormSchema>>;
		deviceTimezone?: string | null;
	} = $props();

	// svelte-ignore state_referenced_locally
	// Captures the load's initial `data` on purpose: `superForm` registers its
	// lifecycle once, and re-running it on every `invalidate()` would reset the
	// field state. The stores it returns are the live connection.
	const superform = superForm(data);
</script>

<form>
	<TimezoneSelect {superform} field="timezone" title="Timezone" {deviceTimezone} />
</form>
