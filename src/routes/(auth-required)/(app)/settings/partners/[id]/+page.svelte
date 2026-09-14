<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import NestedPageHeader from '$lib/components/NestedPageHeader.svelte';
	import PartnerFields from '$lib/components/PartnerFields.svelte';
	import { initialsFor } from '$lib/initials';
	import { shareInviteLink } from '$lib/share';
	import { superForm } from 'sveltekit-superforms';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const partnership = $derived(data.partnership);
	const backHref = resolve('/(auth-required)/(app)/settings/partners');
	// svelte-ignore state_referenced_locally
	// Captures the load's initial `data.partnerEditForm` on purpose: `superForm`
	// registers its lifecycle once, and re-running it on every `invalidate()`
	// would reset the form. `resetForm: false` keeps a failed edit populated.
	const superform = superForm(data.partnerEditForm, { resetForm: false });
	const { errors, submitting } = superform;

	let shareStatus: string | null = $state(null);
	let rotateError: string | null = $state(null);

	async function share(url: string) {
		const outcome = await shareInviteLink(url);
		shareStatus = outcome.shared
			? 'Shared.'
			: outcome.copied
				? 'Link copied to your clipboard.'
				: 'Could not copy automatically — select the link above.';
	}
</script>

<section>
	<NestedPageHeader
		{backHref}
		backLabel="Back to partners"
		backText="Partners"
		title={partnership.partnerName}
		description={[partnership.partnerRole, partnership.yourRole].filter(Boolean).join(' / ') ||
			null}
	/>

	<div class="content">
		<header>
			<wa-avatar
				image={partnership.counterpartImage ?? undefined}
				initials={initialsFor(partnership.partnerName)}
				label={partnership.partnerName}
			></wa-avatar>
		</header>

		{#if partnership.status === 'pending'}
			<div class="pending">
				<h2>Waiting for them to accept</h2>

				{#if data.inviteUrl}
					<p>Send them this link. It stops working once they accept it.</p>
					<!-- readonly rather than disabled so the value can still be selected
				     and copied by hand when the Clipboard API is unavailable. -->
					<input
						class="link"
						type="text"
						readonly
						value={data.inviteUrl}
						aria-label="Invite link"
					/>
					<!-- svelte-ignore a11y_click_events_have_key_events,a11y_no_static_element_interactions -->
					<wa-button onclick={() => data.inviteUrl && share(data.inviteUrl)}>
						<wa-icon slot="start" name="share-nodes" variant="solid"></wa-icon>
						Share link again
					</wa-button>
					{#if shareStatus}<p class="status">{shareStatus}</p>{/if}
				{:else if data.inviteExpired}
					<p class="invalid">This invite link has expired.</p>
				{:else}
					<p>Only the person who created this invite can see the link.</p>
				{/if}

				{#if partnership.role === 'inviter'}
					<form
						method="POST"
						action="?/rotate"
						use:enhance={() => {
							rotateError = null;
							return async ({ result, update }) => {
								if (result.type === 'success' && typeof result.data?.url === 'string') {
									await share(result.data.url);
								} else if (result.type === 'failure') {
									rotateError = String(result.data?.rotateError ?? 'Could not renew the link.');
								}
								// Refresh the load data so the input above shows the new link.
								await update({ reset: false });
							};
						}}
					>
						<wa-button type="submit" appearance="outlined">Create a new link</wa-button>
					</form>
					<p class="hint">Creating a new link stops the old one from working.</p>
					{#if rotateError}<p class="invalid">{rotateError}</p>{/if}
				{/if}
			</div>
		{/if}

		{#if partnership.status === 'accepted' || partnership.canEdit}
			<h2>Settings</h2>
			{#if partnership.canEdit}
				<!-- The Save button lives outside this form, on a shared row with
				     Disconnect — `form="partner-edit"` re-associates it, so it still
				     submits through superforms' enhance. -->
				<form id="partner-edit" method="POST" action="?/update" use:superform.enhance>
					<PartnerFields {superform} />
				</form>
			{:else}
				<dl class="readonly">
					<dt>What you call them</dt>
					<dd>{partnership.partnerName}</dd>
					<dt>What they call you</dt>
					<dd>{partnership.yourName}</dd>
				</dl>
				<p class="hint">They're in control of this link, so only they can change these.</p>
			{/if}
		{/if}

		<div class="actions">
			{#if partnership.canEdit}
				<!-- `disabled={x}`, never `disabled={x || undefined}`. Once Web Awesome
				     upgrades the element Svelte assigns to the `disabled` *property*, and
				     this alpha coerces `undefined` to true — leaving the button permanently
				     disabled. A plain boolean assigns false and behaves. -->
				<wa-button type="submit" form="partner-edit" disabled={$submitting}>Save</wa-button>
			{/if}

			<!-- Always available, whoever holds control: see the disconnect action. -->
			<form
				method="POST"
				action="?/disconnect"
				use:enhance={({ cancel }) => {
					if (!confirm(`Disconnect from ${partnership.partnerName}? This cannot be undone.`))
						cancel();
					return async ({ update }) => update();
				}}
			>
				<wa-button type="submit" appearance="outlined" variant="danger">
					{partnership.status === 'pending' ? 'Cancel invite' : 'Disconnect'}
				</wa-button>
			</form>
		</div>
		{#if $errors._errors}<span class="invalid">{$errors._errors}</span>{/if}
	</div>
</section>

<style>
	section {
		max-width: 40rem;
		margin: 0 auto;
		width: 100%;

		.content {
			display: flex;
			flex-direction: column;
			gap: 1rem;
			padding: var(--wa-space-l);
		}

		header {
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: 0.5rem;

			wa-avatar {
				--size: 4rem;
			}
		}

		h2 {
			font-size: 1rem;
			margin: 0;
		}

		.pending {
			display: flex;
			flex-direction: column;
			gap: 0.75rem;
			border-color: var(--wa-color-surface-border);
			border-radius: var(--wa-panel-border-radius);
			border-style: var(--wa-panel-border-style);
			border-width: var(--wa-panel-border-width);
			padding: var(--wa-space-l);

			p {
				margin: 0;
				color: var(--wa-color-text-quiet);
			}

			.link {
				width: 100%;
				box-sizing: border-box;
				font-family: monospace;
				font-size: 0.8rem;
				padding: 0.5rem;
			}
		}

		form {
			display: flex;
			flex-direction: column;
			gap: 1rem;
		}

		/* The disconnect form contributes only its button, so let the .actions
		   row lay the two buttons out as siblings. */
		.actions {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: 0.75rem;

			form {
				display: contents;
			}
		}

		.readonly {
			margin: 0;

			dt {
				color: var(--wa-color-text-quiet);
				font-size: 0.875em;
			}

			dd {
				margin: 0 0 0.75rem;
				font-weight: var(--wa-font-weight-semibold, 600);
			}
		}

		.hint,
		.status {
			margin: 0;
			color: var(--wa-color-text-quiet);
			font-size: 0.875em;
		}

		.invalid {
			color: var(--wa-color-text-danger);
		}
	}
</style>
