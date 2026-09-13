<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import PartnerFields from '$lib/components/PartnerFields.svelte';
	import { shareInviteLink } from '$lib/share';
	import { superForm } from 'sveltekit-superforms';
	import type { PageData } from './$types';
	import type { InviteCreated } from './+page.server';

	let { data }: { data: PageData } = $props();

	// svelte-ignore state_referenced_locally
	// Captures the load's initial `data.partnerInviteForm` on purpose:
	// `superForm` registers its lifecycle once, and re-running it on every
	// `invalidate()` would reset the form.
	const superform = superForm(data.partnerInviteForm, {
		// The action returns the link instead of redirecting, so this page owns
		// the navigation. See the comment on the action.
		onUpdate: async ({ form }) => {
			// `message()` is how the action smuggles the link back without a
			// redirect; superforms hands it over on `form.message`.
			const created = form.message as InviteCreated | undefined;
			if (!created) return;

			// Started, deliberately NOT awaited. The share sheet has to open inside
			// the click's transient user activation, but it stays open until the
			// user picks something — awaiting it would leave the page frozen
			// mid-submit for as long as they took, and forever on a platform whose
			// share promise never settles. A client-side navigation does not
			// dismiss a browser-level sheet, so both can happen at once.
			void shareInviteLink(created.url);
			await goto(
				resolve('/(auth-required)/(app)/settings/partners/[id]', { id: created.partnershipId })
			);
		}
	});
	const { errors, submitting } = superform;
</script>

<section>
	<h1>Add a partner</h1>
	<p class="intro">
		Answer these, then you'll get a link to send them. Nothing is shared until they open it and
		accept.
	</p>

	<form method="POST" use:superform.enhance>
		<PartnerFields {superform} />

		<!-- `disabled={$submitting}`, never `disabled={$submitting || undefined}`:
		     once Web Awesome upgrades the element Svelte assigns to the `disabled`
		     *property*, and this alpha coerces `undefined` to true, which leaves the
		     button permanently disabled. -->
		<wa-button type="submit" disabled={$submitting}>Create invite link</wa-button>
		{#if $errors._errors}<span class="invalid">{$errors._errors}</span>{/if}

		<a class="cancel" href={resolve('/(auth-required)/(app)/settings/partners')}>Cancel</a>
	</form>
</section>

<style>
	section {
		max-width: 40rem;
		margin: 0 auto;
		padding: var(--wa-space-l);

		h1 {
			margin-top: 0;
		}

		.intro {
			color: var(--wa-color-text-quiet);
		}

		form {
			display: flex;
			flex-direction: column;
			gap: 1rem;

			.invalid {
				color: var(--wa-color-text-danger);
			}

			.cancel {
				text-align: center;
				color: var(--wa-color-text-quiet);
			}
		}
	}
</style>
