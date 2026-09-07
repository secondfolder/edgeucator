import { describe, expect, test } from 'vitest';
import { partnerInviteFormSchema } from './partnerForm';

const valid = { partnerName: 'Ada', yourName: 'Jun', relationshipLabel: 'partner', control: 'mix' };

describe('partnerInviteFormSchema', () => {
	test('accepts the happy path', () => {
		expect(partnerInviteFormSchema.parse(valid)).toEqual(valid);
	});

	test('trims the names', () => {
		const parsed = partnerInviteFormSchema.parse({ ...valid, partnerName: '  Ada  ' });
		expect(parsed.partnerName).toBe('Ada');
	});

	test('rejects a name that is only whitespace', () => {
		expect(partnerInviteFormSchema.safeParse({ ...valid, yourName: '   ' }).success).toBe(false);
	});

	test('rejects a name long enough to break the nav', () => {
		expect(
			partnerInviteFormSchema.safeParse({ ...valid, partnerName: 'a'.repeat(61) }).success
		).toBe(false);
		expect(
			partnerInviteFormSchema.safeParse({ ...valid, partnerName: 'a'.repeat(60) }).success
		).toBe(true);
	});

	test('normalises an empty label to null rather than an empty string', () => {
		expect(
			partnerInviteFormSchema.parse({ ...valid, relationshipLabel: '' }).relationshipLabel
		).toBeNull();
		expect(
			partnerInviteFormSchema.parse({ ...valid, relationshipLabel: '  ' }).relationshipLabel
		).toBeNull();
	});

	test('allows the label to be omitted entirely', () => {
		const withoutLabel = { ...valid };
		delete (withoutLabel as Partial<typeof valid>).relationshipLabel;
		expect(partnerInviteFormSchema.parse(withoutLabel).relationshipLabel).toBeNull();
	});

	test('rejects an over-long label', () => {
		expect(
			partnerInviteFormSchema.safeParse({ ...valid, relationshipLabel: 'a'.repeat(41) }).success
		).toBe(false);
	});

	test('only accepts the three control answers', () => {
		for (const control of ['me', 'them', 'mix']) {
			expect(partnerInviteFormSchema.safeParse({ ...valid, control }).success).toBe(true);
		}
		// 'inviter' is the *stored* value, not an answer — accepting it here would
		// let a crafted post set control without going through controlFromAnswer.
		expect(partnerInviteFormSchema.safeParse({ ...valid, control: 'inviter' }).success).toBe(false);
		expect(partnerInviteFormSchema.safeParse({ ...valid, control: 'both' }).success).toBe(false);
	});
});
