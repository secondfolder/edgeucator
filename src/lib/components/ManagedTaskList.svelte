<script lang="ts">
	import { untrack } from 'svelte';
	// LEGACY-RICHTEXT — delete with the legacy reader; see docs/temporary-code.md
	import { migrateLegacyDescriptions } from '$lib/richtext-legacy-migrate';
	import TimeZoneDisplay from '$lib/components/TimeZoneDisplay.svelte';
	import RichText from '$lib/components/RichText.svelte';
	import { describeTaskSchedule } from '$lib/task-schedule';
	import type { PartnershipTaskView, SelfTaskView } from '$lib/types';

	type TaskView = SelfTaskView | PartnershipTaskView;

	interface Props {
		tasks: TaskView[];
		emptyMessage: string;
		completeAction?: string | null;
		completePartnershipId?: string | null;
		editHref?: ((taskId: string) => string) | null;
	}

	let {
		tasks,
		emptyMessage,
		completeAction = null,
		completePartnershipId = null,
		editHref = null
	}: Props = $props();

	function formatDateTime(date: Date): string {
		return new Intl.DateTimeFormat(undefined, {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(date);
	}

	function isPartnershipTask(task: TaskView): task is PartnershipTaskView {
		return 'createdByMe' in task;
	}

	function canEdit(task: TaskView): boolean {
		return editHref !== null && (!isPartnershipTask(task) || (task.canManage && task.createdByMe));
	}

	function hasActions(task: TaskView): boolean {
		return Boolean((completeAction && task.canComplete) || canEdit(task));
	}

	function availabilityText(task: TaskView): string | null {
		if (!task.active) return 'Inactive';
		if (task.nextEligibleAt) return `Next available ${formatDateTime(task.nextEligibleAt)}`;
		if (task.canComplete) return null;
		if (isPartnershipTask(task) && task.createdByMe) return null;
		return 'Not available right now';
	}

	function isStatusMuted(task: TaskView): boolean {
		return !task.canComplete;
	}

	/**
	 * LEGACY-RICHTEXT — quietly convert any pre-rich-text descriptions the
	 * viewer is allowed to edit. `editHref` being set is the client-side proxy
	 * for "can edit"; the server re-checks it properly. Read untracked so this
	 * does not re-run on every unrelated update.
	 */
	$effect(() => {
		if (!editHref) return;
		void migrateLegacyDescriptions({
			kind: completePartnershipId ? 'partnership-task' : 'self-task',
			partnershipId: completePartnershipId,
			items: untrack(() => tasks.map((task) => ({ id: task.id, description: task.description })))
		});
	});
</script>

{#if tasks.length === 0}
	<p class="empty">{emptyMessage}</p>
{:else}
	<div class="list">
		{#each tasks as task (task.id)}
			<article class="card">
				<div class="content-column">
					<div class="header-row">
						<div>
							<h3>{task.title}</h3>
							<p class="schedule">{describeTaskSchedule(task.schedule)}</p>
							{#if task.timeZoneNote}
								<TimeZoneDisplay
									timeZone={task.timeZoneNote.timeZone}
									referenceTimeZone={task.timeZoneNote.referenceTimeZone}
									date={task.timeZoneNote.date}
									showCurrentTime={task.timeZoneNote.showCurrentTime}
								/>
							{/if}
						</div>
						{#if task.creditsAwarded > 0 && !hasActions(task)}
							<p class:muted-credits={!task.active} class="credits">
								+{task.creditsAwarded} credit{task.creditsAwarded === 1 ? '' : 's'}
							</p>
						{/if}
					</div>

					{#if task.description}
						<div class="description"><RichText text={task.description} /></div>
					{/if}

					<div class="meta">
						{#if availabilityText(task)}
							<p class:muted={isStatusMuted(task)}>{availabilityText(task)}</p>
						{/if}
					</div>
				</div>

				{#if hasActions(task)}
					<div class="actions-column">
						{#if task.creditsAwarded > 0}
							<p class:muted-credits={!task.active} class="credits action-credits">
								+{task.creditsAwarded} credit{task.creditsAwarded === 1 ? '' : 's'}
							</p>
						{/if}
						<div class="actions">
							{#if completeAction && task.canComplete}
								<form method="POST" action={completeAction}>
									<input type="hidden" name="taskId" value={task.id} />
									{#if completePartnershipId}
										<input type="hidden" name="partnershipId" value={completePartnershipId} />
									{/if}
									<wa-button type="submit" appearance="filled">Complete</wa-button>
								</form>
							{/if}
							{#if canEdit(task) && editHref}
								<wa-button appearance="outlined" href={editHref(task.id)}>Edit</wa-button>
							{/if}
						</div>
					</div>
				{/if}
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
		justify-content: space-between;
		align-items: center;
		gap: 0.75rem;
		background: color-mix(
			in srgb,
			var(--wa-color-surface-default) 96%,
			var(--wa-color-brand-fill-quiet)
		);
	}

	.content-column {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.header-row,
	.meta {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
		align-items: start;
	}

	.actions-column {
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.actions {
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: flex-end;
		gap: 0.75rem;
		margin-left: auto;
	}

	.action-credits {
		white-space: nowrap;
	}

	h3,
	p {
		margin: 0;
	}

	.schedule,
	.muted,
	.empty {
		color: var(--wa-color-text-quiet);
	}

	.credits {
		font-weight: 600;
	}

	.muted-credits {
		color: var(--wa-color-text-quiet);
	}

	.description {
		/* No `white-space: pre-wrap`: RichText emits real <br> and <p>,
		   so preserving whitespace here would double every line break. */
		min-inline-size: 0;
	}

	@media (max-width: 640px) {
		.card,
		.header-row,
		.meta {
			flex-direction: column;
		}

		.card {
			align-items: stretch;
		}

		.actions-column {
			align-self: auto;
			flex-direction: column;
			align-items: stretch;
		}

		.actions {
			align-items: stretch;
			margin-left: 0;
		}

		.action-credits {
			white-space: normal;
		}
	}
</style>
