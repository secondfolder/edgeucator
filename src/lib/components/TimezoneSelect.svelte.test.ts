import { fireEvent, render, waitFor } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { describe, expect, test, vi } from 'vitest';
import { superValidate, type Infer, type SuperValidated } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { accountFormSchema, type AccountFormSchema } from '$lib/schemas/accountForm';
import TimezoneSelectHarness from './TimezoneSelectHarness.svelte';

vi.mock('$lib/timezone', () => ({
	canonicalizeTimeZone: (value: string) =>
		['America/New_York', 'Europe/London', 'America/Los_Angeles', 'Pacific/Auckland'].includes(value)
			? value
			: null,
	humanizeTimeZone: (value: string) => value,
	currentTimeZoneOrUtc: () => 'America/New_York',
	supportedTimeZones: () => [
		'UTC',
		'Europe/London',
		'America/New_York',
		'America/Los_Angeles',
		'Pacific/Auckland'
	],
	searchTimeZones: (query: string) => {
		const items =
			query === 'New Zealand'
				? ['Pacific/Auckland', 'Pacific/Chatham']
				: query === 'America/New_York'
					? ['America/New_York', 'America/Los_Angeles']
					: query.includes('Los')
						? ['America/Los_Angeles']
						: [
								'UTC',
								'Europe/London',
								'America/New_York',
								'America/Los_Angeles',
								'Pacific/Auckland',
								'Pacific/Chatham'
							];
		return items;
	}
}));

async function formData(
	overrides: Partial<Infer<AccountFormSchema>> = {}
): Promise<SuperValidated<Infer<AccountFormSchema>>> {
	return superValidate(
		{
			name: 'Ada',
			timezone: 'Europe/London',
			...overrides
		},
		zod4(accountFormSchema),
		{ errors: false }
	);
}

describe('TimezoneSelect', () => {
	test('renders the stored timezone value', async () => {
		const { container } = render(TimezoneSelectHarness, {
			data: await formData()
		});
		const input = container.querySelector('input[role="combobox"]');
		if (!(input instanceof HTMLInputElement)) throw new Error('missing timezone combobox');
		expect(input.value).toBe('Europe/London');
	});

	test('clicking moves the current timezone into the placeholder and clears the value', async () => {
		const { container } = render(TimezoneSelectHarness, {
			data: await formData()
		});
		const input = container.querySelector('input[role="combobox"]');
		const hidden = container.querySelector('input[type="hidden"][name="timezone"]');
		if (!(input instanceof HTMLInputElement)) throw new Error('missing timezone combobox');
		if (!(hidden instanceof HTMLInputElement)) throw new Error('missing hidden timezone input');

		await fireEvent.click(input);

		expect(input.value).toBe('');
		expect(input.placeholder).toBe('Europe/London');
		expect(hidden.value).toBe('Europe/London');
	});

	test('shows the device-timezone shortcut only while the field differs', async () => {
		const { container, getByText, queryByText } = render(TimezoneSelectHarness, {
			data: await formData(),
			deviceTimezone: 'America/New_York'
		});
		expect(getByText('Set to America/New_York')).toBeTruthy();

		const button = container.querySelector('wa-button[type="button"]');
		if (!(button instanceof HTMLElement)) throw new Error('missing use-device-timezone button');
		await fireEvent.click(button);

		await waitFor(() => {
			expect(queryByText('Set to America/New_York')).toBeNull();
			const input = container.querySelector('input[role="combobox"]');
			if (!(input instanceof HTMLInputElement)) throw new Error('missing timezone combobox');
			expect(input.value).toBe('America/New_York');
		});
	});

	test('clicking with a stored value shows the full timezone list', async () => {
		const { getByRole, getAllByRole } = render(TimezoneSelectHarness, {
			data: await formData()
		});
		const combobox = getByRole('combobox');

		await fireEvent.click(combobox);

		expect(getAllByRole('option')).toHaveLength(6);
	});

	test('filters options and stores the selected timezone', async () => {
		const { container, getByRole, getByText } = render(TimezoneSelectHarness, {
			data: await formData()
		});
		const combobox = getByRole('combobox');

		await fireEvent.focus(combobox);
		await fireEvent.input(combobox, { target: { value: 'Los' } });

		const option = getByText('America/Los_Angeles');
		await fireEvent.mouseDown(option);
		await fireEvent.click(option);

		await waitFor(() => {
			const input = container.querySelector('input[role="combobox"]');
			const hidden = container.querySelector('input[type="hidden"][name="timezone"]');
			if (!(input instanceof HTMLInputElement)) throw new Error('missing timezone combobox');
			if (!(hidden instanceof HTMLInputElement)) throw new Error('missing hidden timezone input');
			expect(input.value).toBe('America/Los_Angeles');
			expect(hidden.value).toBe('America/Los_Angeles');
		});
	});

	test('matches a country name to a timezone option', async () => {
		const { getByRole, getByText } = render(TimezoneSelectHarness, {
			data: await formData()
		});
		const combobox = getByRole('combobox');

		await fireEvent.click(combobox);
		await fireEvent.focus(combobox);
		await fireEvent.input(combobox, { target: { value: 'New Zealand' } });

		expect(getByText('Pacific/Auckland')).toBeTruthy();
		expect(getByText('Pacific/Chatham')).toBeTruthy();
	});

	test('keeps an exact timezone code match first', async () => {
		const { container, getByRole, getAllByRole } = render(TimezoneSelectHarness, {
			data: await formData()
		});
		const combobox = getByRole('combobox');

		await fireEvent.focus(combobox);
		await fireEvent.input(combobox, { target: { value: 'America/New_York' } });

		const [first] = getAllByRole('option');
		expect(first).toHaveTextContent('America/New_York');
		const input = container.querySelector('input[role="combobox"]');
		if (!(input instanceof HTMLInputElement)) throw new Error('missing timezone combobox');
		expect(input.value).toBe('America/New_York');
	});
});
