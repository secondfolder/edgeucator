import { fireEvent, render, waitFor } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { describe, expect, test, vi } from 'vitest';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { accountFormSchema } from '$lib/schemas/accountForm';
import type { PageData } from './$types';

const pageState = {
	data: {
		user: {
			id: 'u1',
			name: 'Ada',
			email: 'ada@example.com',
			image: null,
			timezone: 'Europe/London'
		}
	}
};

vi.mock('$app/state', () => ({
	get page() {
		return pageState;
	}
}));

vi.mock('$app/paths', () => ({
	resolve: (id: string, params?: Record<string, string>) =>
		params ? id.replace(/\[(\w+)\]/g, (_, key) => params[key]) : id
}));

vi.mock('$app/navigation', () => ({
	afterNavigate: vi.fn(),
	beforeNavigate: vi.fn(),
	invalidateAll: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('$lib/timezone', () => ({
	canonicalizeTimeZone: (value: string) =>
		['America/New_York', 'Europe/London'].includes(value) ? value : null,
	currentTimeZoneOrUtc: () => 'America/New_York',
	supportedTimeZones: () => ['UTC', 'Europe/London', 'America/New_York', 'America/Los_Angeles'],
	searchTimeZones: (query: string, limit = 12) => {
		const items = query.includes('Los')
			? ['America/Los_Angeles']
			: ['UTC', 'Europe/London', 'America/New_York', 'America/Los_Angeles'];
		return items.slice(0, limit);
	}
}));

const { default: Page } = await import('./+page.svelte');

async function data(timezone = 'Europe/London'): Promise<PageData> {
	return {
		accountForm: await superValidate({ name: 'Ada', timezone }, zod4(accountFormSchema), {
			errors: false
		})
	} as PageData;
}

describe('/settings/account/+page.svelte', () => {
	test('renders the stored timezone value', async () => {
		const { container } = render(Page, { data: await data('Europe/London') });
		const input = container.querySelector('input[role="combobox"]');
		if (!(input instanceof HTMLInputElement)) throw new Error('missing timezone combobox');
		expect(input.value).toBe('Europe/London');
	});

	test('renders the save button outlined before there are changes', async () => {
		const { container } = render(Page, { data: await data('Europe/London') });
		const save = container.querySelector('wa-button[type="submit"]');
		if (!(save instanceof HTMLElement)) throw new Error('missing save button');

		expect(save.getAttribute('appearance')).toBe('outlined');
		expect(save.getAttribute('variant')).toBeNull();
	});

	test('clicking moves the current timezone into the placeholder and clears the value', async () => {
		const { container } = render(Page, { data: await data('Europe/London') });
		const input = container.querySelector('input[role="combobox"]');
		const hidden = container.querySelector('input[type="hidden"][name="timezone"]');
		if (!(input instanceof HTMLInputElement)) throw new Error('missing timezone combobox');
		if (!(hidden instanceof HTMLInputElement)) throw new Error('missing hidden timezone input');

		await fireEvent.click(input);

		expect(input.value).toBe('');
		expect(input.placeholder).toBe('Europe/London');
		expect(hidden.value).toBe('Europe/London');
	});

	test('keeps the save button outlined while the timezone field is only being searched', async () => {
		const { container } = render(Page, { data: await data('Europe/London') });
		const input = container.querySelector('input[role="combobox"]');
		const save = container.querySelector('wa-button[type="submit"]');
		if (!(input instanceof HTMLInputElement)) throw new Error('missing timezone combobox');
		if (!(save instanceof HTMLElement)) throw new Error('missing save button');

		await fireEvent.click(input);

		expect(save.getAttribute('appearance')).toBe('outlined');
		expect(save.getAttribute('variant')).toBeNull();
	});

	test('copies the current device timezone into the form', async () => {
		const { container } = render(Page, { data: await data('Europe/London') });
		const button = container.querySelector('wa-button[type="button"]');
		if (!(button instanceof HTMLElement)) throw new Error('missing use-device-timezone button');

		await fireEvent.click(button);

		await waitFor(() => {
			const input = container.querySelector('input[role="combobox"]');
			if (!(input instanceof HTMLInputElement)) throw new Error('missing timezone combobox');
			expect(input.value).toBe('America/New_York');
		});
	});

	test('promotes the save button to a solid brand style once there are changes', async () => {
		const { container } = render(Page, { data: await data('Europe/London') });
		const button = container.querySelector('wa-button[type="button"]');
		const save = container.querySelector('wa-button[type="submit"]');
		if (!(button instanceof HTMLElement)) throw new Error('missing use-device-timezone button');
		if (!(save instanceof HTMLElement)) throw new Error('missing save button');

		await fireEvent.click(button);

		await waitFor(() => {
			expect(save.getAttribute('appearance')).toBe('filled');
			expect(save.getAttribute('variant')).toBe('brand');
		});
	});

	test('shows the inline Set to action only while the field differs from this device', async () => {
		const { container, getByText, queryByText } = render(Page, {
			data: await data('Europe/London')
		});
		expect(getByText('Set to America/New_York')).toBeTruthy();

		const button = container.querySelector('wa-button[type="button"]');
		if (!(button instanceof HTMLElement)) throw new Error('missing use-device-timezone button');
		await fireEvent.click(button);

		await waitFor(() => {
			expect(queryByText('Set to America/New_York')).toBeNull();
		});
	});

	test('filters the timezone options and stores the selected result', async () => {
		const { container, getByRole, getByText } = render(Page, { data: await data('Europe/London') });
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
});
