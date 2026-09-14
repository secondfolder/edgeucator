import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ADA_RECIPIENT, FAKE_WRAP_BLOB, PASSWORD_WRAP_PARAMS } from '$lib/testing/crypto';
import { createTestDb, type TestDb } from '$lib/testing/db';
import { user as users } from '$lib/server/db/schema/auth';
import { actions, load } from './+page.server';
import { fakeEvent, runAndCatch, runLoad } from '$lib/testing/events';

// See the note in the login test: this covers only the invite round-trip.

const user = { id: 'u1', name: 'Ada', email: 'ada@example.test', image: null, timezone: 'UTC' };
let harness: TestDb;

beforeEach(async () => {
	harness = await createTestDb();
});

afterEach(() => harness.close());

test('offers a validated redirectTo to the page', async () => {
	const data = await runLoad(
		load(fakeEvent({ db: null!, path: '/signup?redirectTo=%2Finvite%2Fabc' }))
	);
	expect(data.redirectTo).toBe('/invite/abc');
});

test('drops a redirectTo that would leave the site', async () => {
	const data = await runLoad(
		load(fakeEvent({ db: null!, path: '/signup?redirectTo=%2F%5Cevil.example' }))
	);
	expect(data.redirectTo).toBeNull();
});

test('sends an already-signed-in visitor on to their invite', async () => {
	const result = await runAndCatch(() =>
		load(fakeEvent({ db: null!, user, path: '/signup?redirectTo=%2Finvite%2Fabc' }))
	);
	expect(result).toMatchObject({ type: 'redirect', location: '/invite/abc' });
});

describe('default action', () => {
	test('persists the submitted timezone on signup', async () => {
		const signUpEmail = vi.fn(
			async ({ body }: { body: { name: string; email: string; timezone: string } }) => {
				await harness.db.insert(users).values({
					id: 'auth-u1',
					name: body.name,
					email: body.email,
					emailVerified: false,
					image: null,
					timezone: body.timezone,
					createdAt: new Date(),
					updatedAt: new Date()
				});

				return { user: { id: 'auth-u1' } };
			}
		);

		const result = await runAndCatch(() =>
			actions.default(
				fakeEvent({
					db: harness.db,
					path: '/signup',
					formData: {
						name: 'Ada',
						email: 'ada@example.test',
						timezone: 'Europe/London',
						authSecret: 'A'.repeat(43),
						recipient: ADA_RECIPIENT,
						wrapParams: JSON.stringify(PASSWORD_WRAP_PARAMS),
						wrapBlob: FAKE_WRAP_BLOB
					},
					authApi: { signUpEmail }
				})
			)
		);

		expect(result).toMatchObject({ type: 'redirect', location: '/home' });
		expect(signUpEmail).toHaveBeenCalledWith(
			expect.objectContaining({
				body: expect.objectContaining({ timezone: 'Europe/London' })
			})
		);

		const rows = await harness.db
			.select({ timezone: users.timezone })
			.from(users)
			.where(eq(users.id, 'auth-u1'))
			.limit(1);
		expect(rows[0]?.timezone).toBe('Europe/London');
	});

	test('rejects an invalid timezone before calling Better Auth', async () => {
		const signUpEmail = vi.fn();

		const result = await actions.default(
			fakeEvent({
				db: harness.db,
				path: '/signup',
				formData: {
					name: 'Ada',
					email: 'ada@example.test',
					timezone: 'Mars/Base',
					authSecret: 'A'.repeat(43),
					recipient: ADA_RECIPIENT,
					wrapParams: JSON.stringify(PASSWORD_WRAP_PARAMS),
					wrapBlob: FAKE_WRAP_BLOB
				},
				authApi: { signUpEmail }
			})
		);

		expect(result).toMatchObject({ status: 400 });
		expect(signUpEmail).not.toHaveBeenCalled();
	});
});
