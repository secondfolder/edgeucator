<script lang="ts">
	import { onMount, tick } from 'svelte';
	import type { Infer, SuperForm } from 'sveltekit-superforms';
	import TaskTimeZoneOwnerToggle from '$lib/components/TaskTimeZoneOwnerToggle.svelte';
	import RichTextEditor from '$lib/components/RichTextEditor.svelte';
	import { DOCUMENT_FEATURES } from '$lib/richtext-editor';
	import { taskEditorFormSchema, type TaskEditorFormSchema } from '$lib/schemas/taskEditorForm';
	import type { TaskWeekday } from '$lib/types';

	type NumericStringField =
		| 'creditsAwarded'
		| 'rollingLimitCompletions'
		| 'rollingLimitEvery'
		| 'afterEvery'
		| 'scheduledInterval'
		| 'scheduledDayOfMonth'
		| 'scheduledCount';
	type StringField =
		| 'title'
		| 'description'
		| 'completionMessagesText'
		| 'scheduledAnchorLocal'
		| 'scheduledUntilLocal';
	type BooleanField = 'active' | 'rollingLimitEnabled';
	type SelectField =
		| 'scheduleMode'
		| 'rollingLimitUnit'
		| 'afterUnit'
		| 'scheduledFrequency'
		| 'scheduledMonthlyPatternKind'
		| 'scheduledOrdinal'
		| 'scheduledWeekday'
		| 'scheduledEndKind';

	type TimeZoneContext = {
		viewerUserId: string;
		viewerTimezone: string;
		counterpartUserId: string;
		counterpartTimezone: string;
		counterpartName: string;
	};

	let {
		superform,
		submitLabel,
		timeZoneContext = null
	}: {
		superform: SuperForm<Infer<TaskEditorFormSchema>>;
		submitLabel: string;
		timeZoneContext?: TimeZoneContext | null;
	} = $props();

	// svelte-ignore state_referenced_locally
	// Captures the initial superform once on purpose: the stores it exposes are
	// the live connection, so there is nothing to gain from re-deriving it.
	const { form, errors, submitting } = superform;
	// svelte-ignore state_referenced_locally
	// The comparison baseline belongs to this mounted form instance. It is
	// intentionally captured once and then optionally rebased after mount.
	let initialValues = $state(structuredClone(superform.capture().data));
	let mounted = $state(false);
	let userEdited = $state(false);

	onMount(() => {
		mounted = true;
		void tick().then(() => {
			if (!userEdited) {
				initialValues = structuredClone(superform.capture().data);
			}
		});
	});

	function markUserEdited() {
		if (!mounted) return;
		userEdited = true;
	}

	function setNumericStringField(field: NumericStringField, event: Event) {
		const input = event.currentTarget;
		if (!(input instanceof HTMLInputElement)) return;
		markUserEdited();
		$form[field] = input.value;
	}

	function setStringField(field: StringField, event: Event) {
		const input = event.currentTarget;
		if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) return;
		markUserEdited();
		$form[field] = input.value;
	}

	/**
	 * The description is a rich-text document, so it arrives as a serialised
	 * string from the editor rather than from a DOM input. It still goes through
	 * the same superforms field, so tainting, validation and the save-button
	 * promotion all behave exactly as they do for every other field.
	 */
	function setDescription(stored: string) {
		markUserEdited();
		$form.description = stored;
	}

	function setBooleanField(field: BooleanField, event: Event) {
		const input = event.currentTarget;
		if (!(input instanceof HTMLInputElement)) return;
		markUserEdited();
		$form[field] = input.checked;
	}

	function setSelectField(field: SelectField, event: Event) {
		const select = event.currentTarget;
		if (!(select instanceof HTMLSelectElement)) return;
		markUserEdited();

		switch (field) {
			case 'scheduleMode':
				if (
					select.value === 'one-off' ||
					select.value === 'rolling-window' ||
					select.value === 'after-completion' ||
					select.value === 'scheduled'
				) {
					$form.scheduleMode = select.value;
				}
				break;
			case 'rollingLimitUnit':
			case 'afterUnit':
				if (
					select.value === 'minute' ||
					select.value === 'hour' ||
					select.value === 'day' ||
					select.value === 'week' ||
					select.value === 'month' ||
					select.value === 'year'
				) {
					if (field === 'rollingLimitUnit') {
						$form.rollingLimitUnit = select.value;
					} else {
						$form.afterUnit = select.value;
					}
				}
				break;
			case 'scheduledFrequency':
				if (
					select.value === 'day' ||
					select.value === 'week' ||
					select.value === 'month' ||
					select.value === 'year'
				) {
					$form.scheduledFrequency = select.value;
				}
				break;
			case 'scheduledMonthlyPatternKind':
				if (select.value === 'day-of-month' || select.value === 'nth-weekday') {
					$form.scheduledMonthlyPatternKind = select.value;
				}
				break;
			case 'scheduledOrdinal':
				if (
					select.value === '1' ||
					select.value === '2' ||
					select.value === '3' ||
					select.value === '4' ||
					select.value === '-1'
				) {
					$form.scheduledOrdinal = select.value;
				}
				break;
			case 'scheduledWeekday':
				if (
					select.value === 'mo' ||
					select.value === 'tu' ||
					select.value === 'we' ||
					select.value === 'th' ||
					select.value === 'fr' ||
					select.value === 'sa' ||
					select.value === 'su'
				) {
					$form.scheduledWeekday = select.value;
				}
				break;
			case 'scheduledEndKind':
				if (select.value === 'never' || select.value === 'until' || select.value === 'count') {
					$form.scheduledEndKind = select.value;
				}
				break;
		}
	}

	function toggleScheduledWeekday(weekday: TaskWeekday, event: Event) {
		const input = event.currentTarget;
		if (!(input instanceof HTMLInputElement)) return;
		markUserEdited();

		if (input.checked) {
			if (!$form.scheduledWeekdays.includes(weekday)) {
				$form.scheduledWeekdays = [...$form.scheduledWeekdays, weekday];
			}
			return;
		}

		$form.scheduledWeekdays = $form.scheduledWeekdays.filter((value) => value !== weekday);
	}

	function firstErrorMessage(value: unknown): string | null {
		if (typeof value === 'string') return value;

		if (Array.isArray(value)) {
			for (const entry of value) {
				const message = firstErrorMessage(entry);
				if (message) return message;
			}
			return null;
		}

		if (!value || typeof value !== 'object') return null;

		if ('_errors' in value) {
			const message = firstErrorMessage((value as { _errors?: unknown })._errors);
			if (message) return message;
		}

		for (const entry of Object.values(value)) {
			const message = firstErrorMessage(entry);
			if (message) return message;
		}

		return null;
	}

	const hasUnsavedChanges = $derived(
		userEdited && JSON.stringify($form) !== JSON.stringify(initialValues)
	);
	const formIsValid = $derived(taskEditorFormSchema.safeParse($form).success);
	const hasValidUnsavedChanges = $derived(hasUnsavedChanges && formIsValid);

	const weekdayOptions: { value: TaskWeekday; label: string }[] = [
		{ value: 'mo', label: 'Mon' },
		{ value: 'tu', label: 'Tue' },
		{ value: 'we', label: 'Wed' },
		{ value: 'th', label: 'Thu' },
		{ value: 'fr', label: 'Fri' },
		{ value: 'sa', label: 'Sat' },
		{ value: 'su', label: 'Sun' }
	];
</script>

<form method="POST" use:superform.enhance class="panel task-form">
	<input type="hidden" name="timezoneOwnerUserId" value={$form.timezoneOwnerUserId} />

	<label>
		<span>Title</span>
		<input
			name="title"
			maxlength="80"
			required
			value={$form.title}
			oninput={(event) => setStringField('title', event)}
		/>
		{#if $errors.title}<span class="invalid">{$errors.title}</span>{/if}
	</label>
	<label>
		<span>Description</span>
		<!--
			A hidden input carries the serialised document, so the form posts the
			same way it always has and the action needs no special case.
		-->
		<input type="hidden" name="description" value={$form.description ?? ''} />
		<div class="richtext-field">
			<RichTextEditor
				value={$form.description ?? ''}
				onChange={setDescription}
				features={DOCUMENT_FEATURES}
				toolbar
				placeholder="What does this involve?"
				ariaLabel="Description"
			/>
		</div>
		{#if $errors.description}<span class="invalid">{$errors.description}</span>{/if}
	</label>
	<div class="editor-row">
		<label>
			<span>Credits awarded</span>
			<input
				type="number"
				min="0"
				step="1"
				name="creditsAwarded"
				required
				value={$form.creditsAwarded}
				oninput={(event) => setNumericStringField('creditsAwarded', event)}
			/>
			{#if $errors.creditsAwarded}<span class="invalid">{$errors.creditsAwarded}</span>{/if}
		</label>
		<label class="checkbox">
			<input
				type="checkbox"
				name="active"
				checked={$form.active}
				onchange={(event) => setBooleanField('active', event)}
			/>
			<span>Active</span>
		</label>
	</div>
	<label>
		<span>Completion messages</span>
		<textarea
			name="completionMessagesText"
			rows="4"
			placeholder="One message per line"
			value={$form.completionMessagesText}
			oninput={(event) => setStringField('completionMessagesText', event)}></textarea>
		{#if $errors.completionMessagesText}
			<span class="invalid">{$errors.completionMessagesText}</span>
		{/if}
	</label>

	<section class="schedule-section">
		<h3>Repeat</h3>
		<label>
			<span>Mode</span>
			<select
				name="scheduleMode"
				value={$form.scheduleMode}
				onchange={(event) => setSelectField('scheduleMode', event)}
			>
				<option value="one-off">One-off</option>
				<option value="rolling-window">Repeat anytime</option>
				<option value="after-completion">After completion</option>
				<option value="scheduled">On a schedule</option>
			</select>
		</label>

		{#if $form.scheduleMode === 'rolling-window'}
			<label class="checkbox">
				<input
					type="checkbox"
					name="rollingLimitEnabled"
					checked={$form.rollingLimitEnabled}
					onchange={(event) => setBooleanField('rollingLimitEnabled', event)}
				/>
				<span>Limit completions per period</span>
			</label>
			{#if $form.rollingLimitEnabled}
				<div class="editor-row">
					<label>
						<span>Completions</span>
						<input
							type="number"
							min="1"
							step="1"
							name="rollingLimitCompletions"
							value={$form.rollingLimitCompletions}
							oninput={(event) => setNumericStringField('rollingLimitCompletions', event)}
						/>
						{#if $errors.rollingLimitCompletions}
							<span class="invalid">{$errors.rollingLimitCompletions}</span>
						{/if}
					</label>
					<label>
						<span>Every</span>
						<input
							type="number"
							min="1"
							step="1"
							name="rollingLimitEvery"
							value={$form.rollingLimitEvery}
							oninput={(event) => setNumericStringField('rollingLimitEvery', event)}
						/>
						{#if $errors.rollingLimitEvery}
							<span class="invalid">{$errors.rollingLimitEvery}</span>
						{/if}
					</label>
					<label>
						<span>Unit</span>
						<select
							name="rollingLimitUnit"
							value={$form.rollingLimitUnit}
							onchange={(event) => setSelectField('rollingLimitUnit', event)}
						>
							<option value="minute">Minutes</option>
							<option value="hour">Hours</option>
							<option value="day">Days</option>
							<option value="week">Weeks</option>
							<option value="month">Months</option>
							<option value="year">Years</option>
						</select>
					</label>
				</div>
			{/if}
		{/if}

		{#if $form.scheduleMode === 'after-completion'}
			<div class="editor-row">
				<label>
					<span>Every</span>
					<input
						type="number"
						min="1"
						step="1"
						name="afterEvery"
						value={$form.afterEvery}
						oninput={(event) => setNumericStringField('afterEvery', event)}
					/>
					{#if $errors.afterEvery}<span class="invalid">{$errors.afterEvery}</span>{/if}
				</label>
				<label>
					<span>Unit</span>
					<select
						name="afterUnit"
						value={$form.afterUnit}
						onchange={(event) => setSelectField('afterUnit', event)}
					>
						<option value="minute">Minutes</option>
						<option value="hour">Hours</option>
						<option value="day">Days</option>
						<option value="week">Weeks</option>
						<option value="month">Months</option>
						<option value="year">Years</option>
					</select>
				</label>
			</div>
		{/if}

		{#if $form.scheduleMode === 'scheduled'}
			<div class="schedule-row">
				<label>
					<span>Starts at</span>
					<input
						type="datetime-local"
						name="scheduledAnchorLocal"
						value={$form.scheduledAnchorLocal}
						oninput={(event) => setStringField('scheduledAnchorLocal', event)}
					/>
					{#if $errors.scheduledAnchorLocal}
						<span class="invalid">{$errors.scheduledAnchorLocal}</span>
					{/if}
				</label>
				{#if timeZoneContext}
					<TaskTimeZoneOwnerToggle
						viewerUserId={timeZoneContext.viewerUserId}
						viewerTimezone={timeZoneContext.viewerTimezone}
						counterpartUserId={timeZoneContext.counterpartUserId}
						counterpartTimezone={timeZoneContext.counterpartTimezone}
						counterpartName={timeZoneContext.counterpartName}
						onSelect={markUserEdited}
						bind:value={$form.timezoneOwnerUserId}
					/>
				{/if}
			</div>

			<div class="editor-row">
				<label>
					<span>Frequency</span>
					<select
						name="scheduledFrequency"
						value={$form.scheduledFrequency}
						onchange={(event) => setSelectField('scheduledFrequency', event)}
					>
						<option value="day">Daily</option>
						<option value="week">Weekly</option>
						<option value="month">Monthly</option>
						<option value="year">Yearly</option>
					</select>
				</label>
				<label>
					<span>Every</span>
					<input
						type="number"
						min="1"
						step="1"
						name="scheduledInterval"
						value={$form.scheduledInterval}
						oninput={(event) => setNumericStringField('scheduledInterval', event)}
					/>
					{#if $errors.scheduledInterval}
						<span class="invalid">{$errors.scheduledInterval}</span>
					{/if}
				</label>
			</div>

			{#if $form.scheduledFrequency === 'week'}
				<fieldset>
					<legend>Days</legend>
					<div class="weekday-grid">
						{#each weekdayOptions as option (option.value)}
							<label class="checkbox compact">
								<input
									type="checkbox"
									name="scheduledWeekdays"
									value={option.value}
									checked={$form.scheduledWeekdays.includes(option.value)}
									onchange={(event) => toggleScheduledWeekday(option.value, event)}
								/>
								<span>{option.label}</span>
							</label>
						{/each}
					</div>
					{#if firstErrorMessage($errors.scheduledWeekdays)}
						<span class="invalid">{firstErrorMessage($errors.scheduledWeekdays)}</span>
					{/if}
				</fieldset>
			{/if}

			{#if $form.scheduledFrequency === 'month'}
				<div class="editor-row">
					<label>
						<span>Monthly pattern</span>
						<select
							name="scheduledMonthlyPatternKind"
							value={$form.scheduledMonthlyPatternKind}
							onchange={(event) => setSelectField('scheduledMonthlyPatternKind', event)}
						>
							<option value="day-of-month">Day of month</option>
							<option value="nth-weekday">Nth weekday</option>
						</select>
					</label>
					{#if $form.scheduledMonthlyPatternKind === 'day-of-month'}
						<label>
							<span>Day</span>
							<input
								type="number"
								min="1"
								max="31"
								step="1"
								name="scheduledDayOfMonth"
								value={$form.scheduledDayOfMonth}
								oninput={(event) => setNumericStringField('scheduledDayOfMonth', event)}
							/>
							{#if $errors.scheduledDayOfMonth}
								<span class="invalid">{$errors.scheduledDayOfMonth}</span>
							{/if}
						</label>
					{:else}
						<label>
							<span>Ordinal</span>
							<select
								name="scheduledOrdinal"
								value={$form.scheduledOrdinal}
								onchange={(event) => setSelectField('scheduledOrdinal', event)}
							>
								<option value="1">First</option>
								<option value="2">Second</option>
								<option value="3">Third</option>
								<option value="4">Fourth</option>
								<option value="-1">Last</option>
							</select>
						</label>
						<label>
							<span>Weekday</span>
							<select
								name="scheduledWeekday"
								value={$form.scheduledWeekday}
								onchange={(event) => setSelectField('scheduledWeekday', event)}
							>
								{#each weekdayOptions as option (option.value)}
									<option value={option.value}>{option.label}</option>
								{/each}
							</select>
						</label>
					{/if}
				</div>
			{/if}

			<div class="editor-row">
				<label>
					<span>Ends</span>
					<select
						name="scheduledEndKind"
						value={$form.scheduledEndKind}
						onchange={(event) => setSelectField('scheduledEndKind', event)}
					>
						<option value="never">Never</option>
						<option value="until">On a date</option>
						<option value="count">After a number of times</option>
					</select>
				</label>
				{#if $form.scheduledEndKind === 'until'}
					<label>
						<span>Until</span>
						<input
							type="datetime-local"
							name="scheduledUntilLocal"
							value={$form.scheduledUntilLocal}
							oninput={(event) => setStringField('scheduledUntilLocal', event)}
						/>
						{#if $errors.scheduledUntilLocal}
							<span class="invalid">{$errors.scheduledUntilLocal}</span>
						{/if}
					</label>
				{:else if $form.scheduledEndKind === 'count'}
					<label>
						<span>Count</span>
						<input
							type="number"
							min="1"
							step="1"
							name="scheduledCount"
							value={$form.scheduledCount}
							oninput={(event) => setNumericStringField('scheduledCount', event)}
						/>
						{#if $errors.scheduledCount}<span class="invalid">{$errors.scheduledCount}</span>{/if}
					</label>
				{/if}
			</div>
			{#if $form.scheduledEndKind === 'until' && timeZoneContext}
				<TaskTimeZoneOwnerToggle
					viewerUserId={timeZoneContext.viewerUserId}
					viewerTimezone={timeZoneContext.viewerTimezone}
					counterpartUserId={timeZoneContext.counterpartUserId}
					counterpartTimezone={timeZoneContext.counterpartTimezone}
					counterpartName={timeZoneContext.counterpartName}
					onSelect={markUserEdited}
					bind:value={$form.timezoneOwnerUserId}
				/>
			{/if}
		{/if}
	</section>

	<wa-button
		type="submit"
		appearance={hasValidUnsavedChanges ? 'filled' : 'outlined'}
		variant={hasValidUnsavedChanges ? 'brand' : undefined}
		disabled={$submitting}
	>
		{submitLabel}
	</wa-button>
	{#if $errors._errors}<span class="invalid">{$errors._errors}</span>{/if}
</form>

<style>
	.panel {
		border: 1px solid var(--wa-color-surface-border);
		border-radius: var(--wa-panel-border-radius);
		padding: var(--wa-space-l);
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	label,
	fieldset {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	fieldset {
		border: 1px solid var(--wa-color-surface-border);
		border-radius: 0.6rem;
		padding: 0.75rem;
	}

	legend {
		padding-inline: 0.35rem;
	}

	.editor-row,
	.schedule-row,
	.weekday-grid {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.weekday-grid {
		gap: 0.5rem 1rem;
	}

	.schedule-section {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	h3 {
		margin: 0;
	}

	input,
	textarea,
	select {
		width: 100%;
		box-sizing: border-box;
		padding: 0.6rem 0.75rem;
		border-radius: 0.6rem;
		border: 1px solid var(--wa-color-surface-border);
		font: inherit;
	}

	.richtext-field {
		inline-size: 100%;
		box-sizing: border-box;
		min-block-size: 4.5rem;
		max-block-size: 40svh;
		overflow-y: auto;
		padding: 0.6rem 0.75rem;
		border-radius: 0.6rem;
		border: 1px solid var(--wa-color-surface-border);
		background: var(--wa-color-surface-lowered, transparent);
	}

	.richtext-field:focus-within {
		outline: 2px solid var(--wa-color-brand-fill-loud, currentColor);
		outline-offset: -1px;
	}

	textarea {
		resize: vertical;
	}

	.checkbox {
		flex-direction: row;
		align-items: center;

		input {
			width: auto;
		}
	}

	.checkbox.compact {
		gap: 0.25rem;
	}

	.invalid {
		color: var(--wa-color-text-danger);
	}

	@media (max-width: 640px) {
		.editor-row,
		.schedule-row {
			flex-direction: column;
		}
	}
</style>
