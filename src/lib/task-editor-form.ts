import type { Infer } from 'sveltekit-superforms';
import type { TaskInput } from './tasks';
import type { TaskEditorFormSchema } from './schemas/taskEditorForm';
import type {
	PartnershipTaskView,
	SelfTaskView,
	TaskMonthlyPattern,
	TaskSchedule,
	TaskScheduleEnd
} from './types';

export type TaskEditorFormValues = Infer<TaskEditorFormSchema>;

type TaskEditableView = SelfTaskView | PartnershipTaskView;

function parseScheduledOrdinal(
	value: TaskEditorFormValues['scheduledOrdinal']
): 1 | 2 | 3 | 4 | -1 {
	switch (value) {
		case '-1':
			return -1;
		case '1':
			return 1;
		case '2':
			return 2;
		case '3':
			return 3;
		case '4':
			return 4;
	}
}

function parseCompletionMessages(text: string | undefined): string[] {
	return (text ?? '')
		.split(/\r?\n/)
		.map((value) => value.trim())
		.filter((value) => value.length > 0);
}

function defaultValues(timezoneOwnerUserId: string): TaskEditorFormValues {
	return {
		title: '',
		description: '',
		creditsAwarded: '0',
		active: true,
		completionMessagesText: '',
		timezoneOwnerUserId,
		scheduleMode: 'one-off',
		rollingLimitEnabled: false,
		rollingLimitCompletions: '1',
		rollingLimitEvery: '1',
		rollingLimitUnit: 'day',
		afterEvery: '1',
		afterUnit: 'day',
		scheduledAnchorLocal: '',
		scheduledFrequency: 'week',
		scheduledInterval: '1',
		scheduledWeekdays: [],
		scheduledMonthlyPatternKind: 'day-of-month',
		scheduledDayOfMonth: '1',
		scheduledOrdinal: '1',
		scheduledWeekday: 'mo',
		scheduledEndKind: 'never',
		scheduledUntilLocal: '',
		scheduledCount: '1'
	};
}

export function taskEditorFormValuesForCreate(timezoneOwnerUserId: string): TaskEditorFormValues {
	return defaultValues(timezoneOwnerUserId);
}

export function taskEditorFormValuesFromTask(task: TaskEditableView): TaskEditorFormValues {
	const values = defaultValues(task.timezoneOwnerUserId);
	values.title = task.title;
	values.description = task.description ?? '';
	values.creditsAwarded = String(task.creditsAwarded);
	values.active = task.active;
	values.completionMessagesText = task.completionMessages.join('\n');
	values.scheduleMode = task.schedule.mode;

	switch (task.schedule.mode) {
		case 'rolling-window':
			values.rollingLimitEnabled = task.schedule.limit !== null;
			values.rollingLimitCompletions = String(task.schedule.limit?.completions ?? 1);
			values.rollingLimitEvery = String(task.schedule.limit?.every ?? 1);
			values.rollingLimitUnit = task.schedule.limit?.unit ?? 'day';
			break;
		case 'after-completion':
			values.afterEvery = String(task.schedule.every);
			values.afterUnit = task.schedule.unit;
			break;
		case 'scheduled': {
			values.scheduledAnchorLocal = task.schedule.anchorLocal;
			values.scheduledFrequency = task.schedule.frequency;
			values.scheduledInterval = String(task.schedule.interval);
			values.scheduledWeekdays = task.schedule.weekdays ?? [];
			values.scheduledMonthlyPatternKind = task.schedule.monthlyPattern?.kind ?? 'day-of-month';
			values.scheduledDayOfMonth = String(
				task.schedule.monthlyPattern?.kind === 'day-of-month'
					? task.schedule.monthlyPattern.day
					: Number(task.schedule.anchorLocal.slice(8, 10))
			);
			const ordinal =
				task.schedule.monthlyPattern?.kind === 'nth-weekday'
					? task.schedule.monthlyPattern.ordinal
					: 1;
			values.scheduledOrdinal =
				ordinal === -1
					? '-1'
					: ordinal === 1
						? '1'
						: ordinal === 2
							? '2'
							: ordinal === 3
								? '3'
								: '4';
			values.scheduledWeekday =
				task.schedule.monthlyPattern?.kind === 'nth-weekday'
					? task.schedule.monthlyPattern.weekday
					: 'mo';
			values.scheduledEndKind = task.schedule.end.kind;
			values.scheduledUntilLocal =
				task.schedule.end.kind === 'until' ? task.schedule.end.untilLocal : '';
			values.scheduledCount =
				task.schedule.end.kind === 'count' ? String(task.schedule.end.count) : '1';
			break;
		}
	}

	return values;
}

function scheduleFromValues(values: TaskEditorFormValues): TaskSchedule {
	switch (values.scheduleMode) {
		case 'one-off':
			return { mode: 'one-off' };
		case 'rolling-window':
			return {
				mode: 'rolling-window',
				limit: values.rollingLimitEnabled
					? {
							completions: Number(values.rollingLimitCompletions),
							every: Number(values.rollingLimitEvery),
							unit: values.rollingLimitUnit
						}
					: null
			};
		case 'after-completion':
			return {
				mode: 'after-completion',
				every: Number(values.afterEvery),
				unit: values.afterUnit
			};
		case 'scheduled': {
			const end: TaskScheduleEnd =
				values.scheduledEndKind === 'until'
					? { kind: 'until', untilLocal: values.scheduledUntilLocal }
					: values.scheduledEndKind === 'count'
						? { kind: 'count', count: Number(values.scheduledCount) }
						: { kind: 'never' };

			const monthlyPattern: TaskMonthlyPattern | undefined =
				values.scheduledFrequency === 'month'
					? values.scheduledMonthlyPatternKind === 'nth-weekday'
						? {
								kind: 'nth-weekday',
								ordinal: parseScheduledOrdinal(values.scheduledOrdinal),
								weekday: values.scheduledWeekday
							}
						: { kind: 'day-of-month', day: Number(values.scheduledDayOfMonth) }
					: undefined;

			return {
				mode: 'scheduled',
				anchorLocal: values.scheduledAnchorLocal,
				frequency: values.scheduledFrequency,
				interval: Number(values.scheduledInterval),
				weekdays: values.scheduledWeekdays,
				monthlyPattern,
				end
			};
		}
	}
}

export function taskInputFromEditorForm(values: TaskEditorFormValues): TaskInput {
	return {
		title: values.title.trim(),
		description: values.description.trim() === '' ? null : values.description.trim(),
		active: values.active,
		creditsAwarded: Number(values.creditsAwarded),
		completionMessages: parseCompletionMessages(values.completionMessagesText),
		timezoneOwnerUserId: values.timezoneOwnerUserId,
		schedule: scheduleFromValues(values)
	};
}
