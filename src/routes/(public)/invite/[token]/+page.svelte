<script lang="ts">
	import { resolve } from '$app/paths';
	import PartnerAcceptForm from '$lib/components/PartnerAcceptForm.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<section>
	{#if data.state === 'invalid'}
		<h1>This link doesn't work</h1>
		<p>It may have expired, already been used, or been cancelled. Ask them to send a new one.</p>
		<a href={resolve('/')}>Go to the home page</a>
	{:else if data.state === 'sign-in-required'}
		<h1>{data.inviterName} wants to add you as a partner</h1>
		<p>Sign in or create an account to see what they're proposing. You can still say no.</p>
		<!-- "Create an account" is primary on purpose: someone reaching an invite
		     link while signed out most likely does not have an account yet, so
		     that is the more probable action — and more probable actions get the
		     solid button. Not plain "Log in" / "Sign up": the (public) header
		     already offers links by those names, and two links with the same
		     accessible name going to different places is a real problem for anyone
		     navigating by link list, not just for a test's locator. -->
		<div class="actions">
			<wa-button
				appearance="outlined"
				href={`${resolve('/login')}?redirectTo=${encodeURIComponent(data.redirectTo)}`}
			>
				Log in to accept
			</wa-button>
			<wa-button href={`${resolve('/signup')}?redirectTo=${encodeURIComponent(data.redirectTo)}`}>
				Create an account
			</wa-button>
		</div>
	{:else if data.state === 'self'}
		<h1>That's your own link</h1>
		<p>Send it to the person you want to link with.</p>
		<a href={resolve('/(auth-required)/(app)/settings/partners')}>Back to partners</a>
	{:else if data.state === 'already-linked'}
		<h1>You're already linked</h1>
		<p>You and {data.inviterName} are already partners.</p>
		<a href={resolve('/(auth-required)/(app)/settings/partners')}>Back to partners</a>
	{:else if data.state === 'confirm'}
		<h1>{data.inviterName} wants to add you as a partner</h1>
		<p>
			{#if data.editable}
				Check these over — you can change them — then accept.
			{:else}
				If you accept, they'll be able to set tasks, rewards and punishments for you.
			{/if}
		</p>

		<PartnerAcceptForm data={data.partnerAcceptForm} editable={data.editable}>
			<a class="decline" href={resolve('/')}>Not now</a>
		</PartnerAcceptForm>
	{/if}
</section>

<style>
	section {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		max-width: 30rem;
		margin: 0 auto;

		h1 {
			margin-bottom: 0;
			font-size: 1.5rem;
		}

		p {
			margin: 0;
			color: var(--wa-color-text-quiet);
		}

		.actions {
			display: flex;
			gap: 0.75rem;
		}

		.decline {
			color: var(--wa-color-text-quiet);
		}
	}
</style>
