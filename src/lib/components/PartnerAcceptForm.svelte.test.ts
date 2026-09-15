import { describe, expect, test } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { superValidate, type Infer, type SuperValidated } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { partnerInviteFormSchema, type PartnerInviteFormSchema } from '$lib/schemas/partnerForm';
import PartnerAcceptForm from './PartnerAcceptForm.svelte';

/**
 * `PartnerFields` is exercised through this component rather than on its own,
 * because `superForm()` registers an `onDestroy` and so can only be called
 * during component initialisation — a test cannot build one and pass it in.
 * Going through the real wrapper also means the composition is under test.
 *
 * What these cover is the UI half of the permission rule: which answers the
 * accepter can change. The other half — the server ignoring what a read-only
 * form posts back — is in the invite page's server test.
 */

async function formData(
	overrides: Partial<Infer<PartnerInviteFormSchema>> = {}
): Promise<SuperValidated<Infer<PartnerInviteFormSchema>>> {
	return superValidate(
		{
			partnerName: 'Ada',
			yourName: 'Jun',
			partnerRole: 'dom',
			yourRole: 'sub',
			control: 'mix' as const,
			...overrides
		},
		zod4(partnerInviteFormSchema),
		{ errors: false }
	);
}

const radio = (value: string): HTMLInputElement => {
	const found = document.querySelector<HTMLInputElement>(`input[name="control"][value="${value}"]`);
	if (!found) throw new Error(`no control radio for ${value}`);
	return found;
};

const controlValues = () =>
	[...document.querySelectorAll('input[name="control"]')].map((el) => el.getAttribute('value'));

const waInputNames = (container: HTMLElement) =>
	[...container.querySelectorAll('wa-input')].map((el) => el.getAttribute('name'));

describe('when the accepter is allowed to edit', () => {
	test('renders the names and roles as inputs', async () => {
		const { container } = render(PartnerAcceptForm, { data: await formData(), editable: true });
		// wa-input is a custom element the CDN upgrades at runtime; in jsdom it
		// is inert, so the assertion is on what the component emits.
		expect(waInputNames(container)).toEqual(['partnerName', 'yourName', 'partnerRole', 'yourRole']);
	});

	test('groups the fields under their section titles', async () => {
		const { container } = render(PartnerAcceptForm, { data: await formData(), editable: true });
		const legends = [...container.querySelectorAll('legend')].map((el) => el.textContent?.trim());
		expect(legends).toEqual(['Name/Title', 'Roles', 'Who calls the shots?']);
		expect(container.textContent).toContain('How should you both refer to each other?');
		expect(container.querySelectorAll('.inline-fields')).toHaveLength(1);
		expect(container.querySelectorAll('.stacked-fields')).toHaveLength(1);
	});

	test('labels each field theirs or yours', async () => {
		const { container } = render(PartnerAcceptForm, { data: await formData(), editable: true });
		const labels = [...container.querySelectorAll('wa-input')].map((el) =>
			el.getAttribute('label')
		);
		expect(labels).toEqual(['Theirs', 'Yours', 'Theirs', 'Yours']);
	});

	test('offers exactly the three control answers, in that order', async () => {
		render(PartnerAcceptForm, { data: await formData(), editable: true });
		expect(controlValues()).toEqual(['me', 'them', 'mix']);
	});

	test('preselects the answer that came from the server', async () => {
		render(PartnerAcceptForm, { data: await formData({ control: 'them' }), editable: true });
		expect(radio('them')).toBeChecked();
		expect(radio('me')).not.toBeChecked();
	});

	test('lets the control answer be changed', async () => {
		render(PartnerAcceptForm, { data: await formData({ control: 'mix' }), editable: true });
		await fireEvent.click(radio('me'));
		expect(radio('me')).toBeChecked();
		expect(radio('mix')).not.toBeChecked();
	});

	test('renders the values the server prefilled, not blank fields', async () => {
		// The regression this guards: InputField had no `value` at all, so every
		// prefilled form came up empty and then posted those blanks back.
		const { container } = render(PartnerAcceptForm, { data: await formData(), editable: true });
		const values = Object.fromEntries(
			[...container.querySelectorAll('wa-input')].map((el) => [
				el.getAttribute('name'),
				el.getAttribute('value')
			])
		);
		expect(values).toEqual({
			partnerName: 'Ada',
			yourName: 'Jun',
			partnerRole: 'dom',
			yourRole: 'sub'
		});
	});

	test('shows each role input with a dimmed name prefix from its matching name field', async () => {
		const { container } = render(PartnerAcceptForm, { data: await formData(), editable: true });
		const partnerRole = container.querySelector('wa-input[name="partnerRole"]');
		const yourRole = container.querySelector('wa-input[name="yourRole"]');
		expect(partnerRole?.textContent).toContain("Jun's");
		expect(yourRole?.textContent).toContain("Ada's");
	});

	test('renders an absent role as an empty field, not the string "null"', async () => {
		const { container } = render(PartnerAcceptForm, {
			data: await formData({ partnerRole: null }),
			editable: true
		});
		expect(container.querySelector('wa-input[name="partnerRole"]')?.getAttribute('value')).toBe('');
	});

	test('emits no hidden duplicates of the visible fields', async () => {
		const { container } = render(PartnerAcceptForm, { data: await formData(), editable: true });
		expect(container.querySelectorAll('input[type="hidden"]')).toHaveLength(0);
	});
});

describe('when the inviter keeps control', () => {
	test('shows the answers as text instead of inputs', async () => {
		const { container } = render(PartnerAcceptForm, { data: await formData(), editable: false });

		expect(waInputNames(container)).toEqual([]);
		expect(screen.getByText('Ada')).toBeInTheDocument();
		expect(screen.getByText('Jun')).toBeInTheDocument();
		expect(screen.getByText("Jun's dom")).toBeInTheDocument();
		expect(screen.getByText("Ada's sub")).toBeInTheDocument();
	});

	test('still submits every value, so the payload matches the same schema', async () => {
		const { container } = render(PartnerAcceptForm, {
			data: await formData({ control: 'them' }),
			editable: false
		});

		const hidden = Object.fromEntries(
			[...container.querySelectorAll<HTMLInputElement>('input[type="hidden"]')].map((el) => [
				el.name,
				el.value
			])
		);
		expect(hidden).toEqual({
			partnerName: 'Ada',
			yourName: 'Jun',
			partnerRole: 'dom',
			yourRole: 'sub',
			control: 'them'
		});
	});

	test('omits the control question entirely rather than showing disabled radios', async () => {
		// Someone who cannot change the answer is not asked it — a row of
		// disabled radios is noise, not information.
		render(PartnerAcceptForm, { data: await formData(), editable: false });
		expect(document.querySelectorAll('input[name="control"][type="radio"]')).toHaveLength(0);
		expect(screen.queryByText('Who calls the shots?')).not.toBeInTheDocument();
	});

	test('leaves the roles section values out when there are none', async () => {
		render(PartnerAcceptForm, {
			data: await formData({ partnerRole: null, yourRole: null }),
			editable: false
		});
		expect(screen.queryByText('dom')).not.toBeInTheDocument();
		expect(screen.queryByText('sub')).not.toBeInTheDocument();
	});

	test('sends an empty string rather than "null" for a missing role', async () => {
		// `value={null}` would serialise as the literal string "null" and be
		// stored as a role reading null.
		const { container } = render(PartnerAcceptForm, {
			data: await formData({ partnerRole: null, yourRole: null }),
			editable: false
		});
		expect(container.querySelector<HTMLInputElement>('input[name="partnerRole"]')?.value).toBe('');
		expect(container.querySelector<HTMLInputElement>('input[name="yourRole"]')?.value).toBe('');
	});
});

test('the form posts back to the invite URL it was served from', async () => {
	const { container } = render(PartnerAcceptForm, { data: await formData(), editable: true });
	const form = container.querySelector('form');
	expect(form).toHaveAttribute('method', 'POST');
	// No `action`: the default action on the current URL is what carries the
	// token, which lives in the path.
	expect(form?.hasAttribute('action')).toBe(false);
});
