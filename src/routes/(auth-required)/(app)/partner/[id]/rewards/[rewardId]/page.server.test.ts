import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { actions, load } from './+page.server';
import type { Db } from '$lib/server/db';
import { createTestDb, type TestDb } from '$lib/testing/db';
import {
	createTestPartnership,
	createTestPartnershipReward,
	createTestUser,
	readPartnershipRewardRow,
	type TestUser
} from '$lib/testing/fixtures';
import { fakeEvent, runAndCatch, runLoad } from '$lib/testing/events';

let harness: TestDb;
let db: Db;
let ada: TestUser;
let jun: TestUser;

beforeEach(async () => {
	harness = await createTestDb();
	db = harness.db;
	ada = await createTestUser(db, { name: 'Ada' });
	jun = await createTestUser(db, { name: 'Jun' });
});

afterEach(() => harness.close());

const at = (
	id: string,
	rewardId: string,
	user: TestUser | null,
	formData?: Record<string, string>
) =>
	fakeEvent({
		db,
		user,
		params: { id, rewardId },
		formData,
		path: `/partner/${id}/rewards/${rewardId}`
	});

describe('load', () => {
	test('loads one existing partnership reward for the controlling side', async () => {
		const { id } = await createTestPartnership(db, ada, jun, { control: 'me' });
		const reward = await createTestPartnershipReward(db, id, ada, { title: 'Tea', cost: 2 });
		await expect(runLoad(load(at(id, reward.id, ada)))).resolves.toMatchObject({
			partner: { id, name: 'Them', canManageRewards: true },
			reward: { id: reward.id, title: 'Tea', cost: 2 }
		});
	});

	test('403s for the non-controlling side', async () => {
		const { id } = await createTestPartnership(db, ada, jun, { control: 'me' });
		const reward = await createTestPartnershipReward(db, id, ada, { title: 'Tea', cost: 2 });
		const result = await runAndCatch(() => runLoad(load(at(id, reward.id, jun))));
		expect(result).toMatchObject({ type: 'error', status: 403 });
	});
});

describe('actions', () => {
	test('updates the reward and redirects back to the partnership rewards page', async () => {
		const { id } = await createTestPartnership(db, ada, jun, { control: 'me' });
		const reward = await createTestPartnershipReward(db, id, ada, { title: 'Tea', cost: 2 });
		const result = await runAndCatch(() =>
			actions.default?.(
				at(id, reward.id, ada, {
					title: 'Tea time',
					description: 'Fresh pot',
					cost: '3',
					active: 'on'
				})
			)
		);

		expect(result).toMatchObject({
			type: 'redirect',
			status: 303,
			location: `/partner/${id}/rewards`
		});
		await expect(readPartnershipRewardRow(db, reward.id)).resolves.toMatchObject({
			title: 'Tea time',
			cost: 3
		});
	});
});
