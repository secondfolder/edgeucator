<script lang="ts">
	import ManagedTaskList from '$lib/components/ManagedTaskList.svelte';
	import type { PartnershipTaskView, SelfTaskView } from '$lib/types';

	type TaskView = SelfTaskView | PartnershipTaskView;

	interface Props {
		title: string;
		tasks: TaskView[];
		emptyMessage: string;
		completeAction?: string | null;
		completePartnershipId?: string | null;
		editHref?: ((taskId: string) => string) | null;
		historyHref?: string | null;
		historyLabel?: string;
		addHref?: string | null;
		addLabel?: string;
		extraHref?: string | null;
		extraLabel?: string;
		wrapInPanel?: boolean;
	}

	let {
		title,
		tasks,
		emptyMessage,
		completeAction = null,
		completePartnershipId = null,
		editHref = null,
		historyHref = null,
		historyLabel = 'Completion History',
		addHref = null,
		addLabel = 'Add a task',
		extraHref = null,
		extraLabel = '',
		wrapInPanel = true
	}: Props = $props();
</script>

<section class:panel={wrapInPanel} class="task-section">
	<div class="section-header">
		<h2>{title}</h2>
		{#if historyHref || extraHref || addHref}
			<div class="section-actions">
				{#if historyHref}
					<wa-button appearance="outlined" href={historyHref}>{historyLabel}</wa-button>
				{/if}
				{#if extraHref && extraLabel}
					<wa-button appearance="outlined" href={extraHref}>{extraLabel}</wa-button>
				{/if}
				{#if addHref}
					<wa-button appearance="outlined" href={addHref}>{addLabel}</wa-button>
				{/if}
			</div>
		{/if}
	</div>

	<ManagedTaskList {tasks} {emptyMessage} {completeAction} {completePartnershipId} {editHref} />
</section>

<style>
	.task-section {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.section-header,
	.section-actions {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.section-header {
		justify-content: space-between;
		align-items: center;
	}

	.panel {
		border: 1px solid var(--wa-color-surface-border);
		border-radius: var(--wa-panel-border-radius);
		padding: var(--wa-space-l);
		background: color-mix(
			in srgb,
			var(--wa-color-surface-default) 94%,
			var(--wa-color-brand-fill-quiet)
		);
	}

	h2 {
		margin: 0;
	}
</style>
