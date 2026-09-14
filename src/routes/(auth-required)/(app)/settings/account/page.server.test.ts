import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '$lib/testing/db';
import { createTestUser, type TestUser } from '$lib/testing/fixtures';
import { fakeEvent, runAndCatch, runLoad } from '$lib/testing/events';
import { user } from '$lib/server/db/schema/auth';
import { actions, load } from './+page.server';

let harness: TestDb;
let ada: TestUser;

beforeEach(async () => {
	harness = await createTestDb();
	ada = await createTestUser(harness.db, { name: 'Ada' });
});

afterEach(() => harness.close());

describe('load', () => {
	it('refuses an unsigned visitor', async () => {
		const result = await runAndCatch(() => load(fakeEvent({ db: harness.db })));
		expect(result).toMatchObject({ type: 'error', status: 401 });
	});

	it('seeds the current name into the form', async () => {
		const data = await runLoad(load(fakeEvent({ db: harness.db, user: ada })));
		expect(data.accountForm.data).toMatchObject({ name: ada.name, timezone: ada.timezone });
	});
});

describe('update', () => {
	it('updates the signed-in user', async () => {
		const updateUser = vi.fn(async ({ body }: { body: { name?: string; timezone?: string } }) => {
			await harness.db
				.update(user)
				.set({
					name: body.name ?? ada.name,
					timezone: body.timezone ?? ada.timezone,
					updatedAt: new Date()
				})
				.where(eq(user.id, ada.id));
			return { status: true };
		});

		const result = await actions.update(
			fakeEvent({
				db: harness.db,
				user: ada,
				formData: { name: 'Ada Lovelace', timezone: 'America/Los_Angeles' },
				authApi: { updateUser }
			})
		);

		expect(result).toMatchObject({ accountForm: { valid: true } });
		expect(updateUser).toHaveBeenCalledWith(
			expect.objectContaining({
				body: { name: 'Ada Lovelace', timezone: 'America/Los_Angeles' }
			})
		);
		const rows = await harness.db
			.select({ name: user.name, email: user.email, timezone: user.timezone })
			.from(user)
			.where(eq(user.id, ada.id))
			.limit(1);
		expect(rows[0]).toMatchObject({
			name: 'Ada Lovelace',
			email: ada.email,
			timezone: 'America/Los_Angeles'
		});
	});

	it('returns a validation failure without writing', async () => {
		const result = await actions.update(
			fakeEvent({
				db: harness.db,
				user: ada,
				formData: { name: '', timezone: 'UTC' }
			})
		);

		expect(result).toMatchObject({ status: 400 });
		const rows = await harness.db
			.select({ name: user.name, email: user.email, timezone: user.timezone })
			.from(user)
			.where(eq(user.id, ada.id))
			.limit(1);
		expect(rows[0]).toMatchObject({ name: ada.name, email: ada.email, timezone: ada.timezone });
	});

	it('returns an auth-layer failure cleanly', async () => {
		const result = await actions.update(
			fakeEvent({
				db: harness.db,
				user: ada,
				formData: { name: 'Ada Lovelace', timezone: 'UTC' },
				authApi: {
					updateUser: async () => {
						throw new Error('boom');
					}
				}
			})
		);

		expect(JSON.stringify(result)).toContain('Could not update your account');
	});
});
