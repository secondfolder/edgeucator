import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { actions } from './+page.server';
import type { Db } from '$lib/server/db';
import { createTestDb, type TestDb } from '$lib/testing/db';
import { createTestUser, type TestUser } from '$lib/testing/fixtures';
import { fakeEvent, runAndCatch } from '$lib/testing/events';
import { getSelfRewardsSection } from '$lib/server/rewards';

let harness: TestDb;
let db: Db;
let ada: TestUser;

beforeEach(async () => {
	harness = await createTestDb();
	db = harness.db;
	ada = await createTestUser(db, { name: 'Ada' });
});

afterEach(() => harness.close());

const at = (user: TestUser | null, formData?: Record<string, string>) =>
	fakeEvent({ db, user, formData, path: '/home/rewards/add' });

describe('actions', () => {
	test('creates a self reward and redirects to home', async () => {
		const result = await runAndCatch(() =>
			actions.default?.(
				at(ada, {
					title: 'Bath',
					description: 'Hot bath',
					cost: '3',
					active: 'on'
				})
			)
		);

		expect(result).toMatchObject({ type: 'redirect', status: 303, location: '/home/rewards' });
		const section = await getSelfRewardsSection(db, ada.id);
		expect(section.rewards).toContainEqual(expect.objectContaining({ title: 'Bath', cost: 3 }));
	});

	test('401s without a session', async () => {
		const result = await runAndCatch(() =>
			actions.default?.(at(null, { title: 'Bath', description: '', cost: '3', active: 'on' }))
		);
		expect(result).toMatchObject({ type: 'error', status: 401 });
	});
});
