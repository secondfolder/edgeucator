<script lang="ts">
	import RichText from '$lib/components/RichText.svelte';
	import type { PartnershipTaskCompletionView, TaskCompletionView } from '$lib/types';

	type CompletionView = TaskCompletionView | PartnershipTaskCompletionView;

	interface Props {
		completions: CompletionView[];
		emptyMessage: string;
	}

	let { completions, emptyMessage }: Props = $props();

	function formatDateTime(date: Date): string {
		return new Intl.DateTimeFormat(undefined, {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(date);
	}

	function isPartnershipCompletion(
		completion: CompletionView
	): completion is PartnershipTaskCompletionView {
		return 'mine' in completion;
	}
</script>

{#if completions.length === 0}
	<p class="empty">{emptyMessage}</p>
{:else}
	<div class="list">
		{#each completions as completion (completion.id)}
			<article class="card">
				<div class="header-row">
					<h3>{completion.taskTitle}</h3>
					<p class="credits">
						+{completion.creditsAwarded} credit{completion.creditsAwarded === 1 ? '' : 's'}
					</p>
				</div>
				{#if completion.taskDescription}
					<div class="description"><RichText text={completion.taskDescription} /></div>
				{/if}
				{#if completion.completionMessage}
					<p class="message">{completion.completionMessage}</p>
				{/if}
				<div class="meta">
					<p class="muted">{formatDateTime(completion.createdAt)}</p>
					{#if isPartnershipCompletion(completion)}
						<p class="muted">
							{completion.mine ? 'Completed by you' : 'Completed by your partner'}
							{#if completion.createdByMe}
								· Created by you{/if}
						</p>
					{/if}
				</div>
			</article>
		{/each}
	</div>
{/if}

<style>
	.list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.card {
		border: 1px solid var(--wa-color-surface-border);
		border-radius: var(--wa-panel-border-radius);
		padding: var(--wa-space-m);
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.header-row,
	.meta {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	h3,
	p {
		margin: 0;
	}

	.credits {
		font-weight: 600;
	}

	.empty,
	.muted,
	.message {
		color: var(--wa-color-text-quiet);
	}

	@media (max-width: 640px) {
		.header-row,
		.meta {
			flex-direction: column;
		}
	}
</style>
