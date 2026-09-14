import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { describe, expect, test } from 'vitest';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { taskEditorFormValuesForCreate, type TaskEditorFormValues } from '$lib/task-editor-form';
import { taskEditorFormSchema } from '$lib/schemas/taskEditorForm';

const { default: TaskFormHarness } = await import('$lib/testing/TaskFormHarness.svelte');

function editValues(): TaskEditorFormValues {
	return {
		...taskEditorFormValuesForCreate('u1'),
		title: 'Long shower',
		description: 'Take your time',
		creditsAwarded: '2',
		completionMessagesText: 'Nicely done'
	};
}

describe('TaskForm', () => {
	test('starts outlined on a fresh add form and becomes solid once edited', async () => {
		const data = await superValidate(
			taskEditorFormValuesForCreate('u1'),
			zod4(taskEditorFormSchema),
			{
				errors: false
			}
		);
		const { container } = render(TaskFormHarness, {
			data,
			submitLabel: 'Add task'
		});
		const save = container.querySelector('wa-button[type="submit"]');
		const title = container.querySelector('input[name="title"]');
		if (!(save instanceof HTMLElement)) throw new Error('missing submit button');
		if (!(title instanceof HTMLInputElement)) throw new Error('missing title input');

		expect(save.getAttribute('appearance')).toBe('outlined');
		expect(save.getAttribute('variant')).toBeNull();

		await fireEvent.input(title, { target: { value: 'Long shower' } });

		await waitFor(() => {
			expect(save.getAttribute('appearance')).toBe('filled');
			expect(save.getAttribute('variant')).toBe('brand');
		});
	});

	test('starts outlined on an edit form and stays outlined until something changes', async () => {
		const data = await superValidate(editValues(), zod4(taskEditorFormSchema), { errors: false });
		const { container } = render(TaskFormHarness, {
			data,
			submitLabel: 'Save task'
		});
		const save = container.querySelector('wa-button[type="submit"]');
		const title = container.querySelector('input[name="title"]');
		if (!(save instanceof HTMLElement)) throw new Error('missing submit button');
		if (!(title instanceof HTMLInputElement)) throw new Error('missing title input');

		expect(save.getAttribute('appearance')).toBe('outlined');
		expect(save.getAttribute('variant')).toBeNull();

		await fireEvent.input(title, { target: { value: '' } });

		await waitFor(() => {
			expect(save.getAttribute('appearance')).toBe('outlined');
			expect(save.getAttribute('variant')).toBeNull();
		});

		await fireEvent.input(title, { target: { value: 'Long shower deluxe' } });

		await waitFor(() => {
			expect(save.getAttribute('appearance')).toBe('filled');
			expect(save.getAttribute('variant')).toBe('brand');
		});
	});

	test('shows the weekly Days validation error as text', async () => {
		const data = await superValidate(
			{
				...taskEditorFormValuesForCreate('u1'),
				title: 'Stretch',
				scheduleMode: 'scheduled',
				scheduledFrequency: 'week',
				scheduledAnchorLocal: '2026-09-14T10:00',
				scheduledWeekdays: []
			},
			zod4(taskEditorFormSchema)
		);

		render(TaskFormHarness, {
			data,
			submitLabel: 'Add task'
		});

		expect(screen.getByText('Choose at least one day')).toBeInTheDocument();
		expect(screen.queryByText('[object Object]')).not.toBeInTheDocument();
	});
});
