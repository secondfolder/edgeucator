<script lang="ts">
	/**
	 * The one blunt warning about losing the password.
	 *
	 * Shown here, on the first visit to a messaging page, rather than at signup:
	 * at signup there is no history to lose and a warning that big would just be
	 * alarming about something the user has not started using. Here they are
	 * about to have something worth losing.
	 *
	 * It blocks the board until acknowledged, deliberately — a dismissible
	 * banner is exactly the thing people scroll past.
	 */
	let {
		acknowledge,
		hasPasskey = false
	}: {
		acknowledge: () => Promise<void>;
		hasPasskey?: boolean;
	} = $props();

	let confirmed = $state(false);
	let busy = $state(false);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!confirmed || busy) return;
		busy = true;
		try {
			await acknowledge();
		} finally {
			busy = false;
		}
	}
</script>

<section>
	<wa-callout variant="warning">
		<wa-icon slot="icon" name="triangle-exclamation" variant="solid"></wa-icon>
		<h2>Before you start</h2>
		<p>
			<strong>Your password is the only key to these messages.</strong> They are encrypted on your device,
			and the server keeps a copy it cannot read — which is the point, and also the catch: nobody can
			reset it for you.
		</p>
		<p>
			If you forget it, everything here becomes unreadable on every device. So write it down
			somewhere you will still have it in a year.
		</p>
		{#if !hasPasskey}
			<p class="aside">
				It is also worth adding a passkey, in Settings. Without one, forgetting your password means
				losing the account as well as the messages — with one, your partner can help you get the
				history back.
			</p>
		{/if}

		<form onsubmit={submit}>
			<label>
				<!-- A native checkbox rather than <wa-checkbox>: this gates an
				     acknowledgement about permanent data loss, so it has to work even
				     if the custom element never upgrades. Same reasoning as the
				     radios in PartnerFields.svelte. -->
				<input type="checkbox" bind:checked={confirmed} />
				<span>I have written my password down somewhere safe.</span>
			</label>
			<wa-button type="submit" variant="brand" disabled={!confirmed || busy}>
				Start messaging
			</wa-button>
		</form>
	</wa-callout>
</section>

<style>
	section {
		max-width: 34rem;
		margin: 0 auto;
		padding: var(--wa-space-l);

		h2 {
			margin: 0 0 0.5rem;
			font-size: 1.0625rem;
		}

		p {
			margin: 0 0 0.625rem;
			font-size: 0.9375rem;
		}

		.aside {
			color: var(--wa-color-text-quiet);
			font-size: 0.875rem;
		}

		form {
			display: flex;
			flex-direction: column;
			gap: 0.75rem;

			label {
				display: flex;
				gap: 0.5rem;
				align-items: flex-start;
				font-size: 0.875rem;

				input {
					margin-block-start: 0.125rem;
				}
			}
		}
	}
</style>
