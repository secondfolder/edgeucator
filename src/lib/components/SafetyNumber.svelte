<script lang="ts">
	/**
	 * The number two partners read to each other to check nobody is in between.
	 *
	 * Presented as something to *say out loud*, not something to eyeball on a
	 * screen: the whole value of this number is that it travels over a channel
	 * the server does not control. Copy that said "compare these" without saying
	 * "not in this app" would quietly make it useless, since a server that can
	 * swap a key can also swap what both people see here.
	 */
	let {
		value,
		partnerName,
		/** Shown when the key has changed, where the framing has to be different. */
		tone = 'neutral'
	}: {
		value: string;
		partnerName: string;
		tone?: 'neutral' | 'warning';
	} = $props();
</script>

<div class="safety" class:warning={tone === 'warning'}>
	<!--
		A <p>, not an <output> or a heading: it is static text, and its own
		aria-label would only read the digits twice. The grouping hyphens are part
		of the value (see formatSafetyNumber) so a screen reader pauses between
		groups, which is what makes it readable aloud.
	-->
	<p class="number">{value}</p>
	<p class="how">
		Say this to {partnerName} in person, or over a call — somewhere other than this app. If their number
		is the same, nobody is reading your messages. If it is different, stop and tell each other.
	</p>
</div>

<style>
	.safety {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		padding: var(--wa-space-s) var(--wa-space-m);
		border-radius: var(--wa-border-radius-m, 0.375rem);
		background-color: var(--wa-color-surface-lowered, rgb(0 0 0 / 4%));

		.number {
			margin: 0;
			font-family: var(--wa-font-family-code, monospace);
			/* Big, because it is read aloud character by character. */
			font-size: 1.125rem;
			letter-spacing: 0.06em;
			/* A long number must wrap rather than widen the page — the shell has no
			   horizontal scroll and this sits inside a callout on a 320px phone. */
			overflow-wrap: anywhere;
		}

		.how {
			margin: 0;
			font-size: 0.8125rem;
			color: var(--wa-color-text-quiet);
		}

		&.warning .number {
			color: var(--wa-color-text-danger);
		}
	}
</style>
