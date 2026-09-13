import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { load } from './+page.server';
import type { Db } from '$lib/server/db';
import { createTestDb, type TestDb } from '$lib/testing/db';
import {
	claimTestSelfReward,
	createTestSelfReward,
	createTestUser,
	setTestSelfRewardCredits,
	type TestUser
} from '$lib/testing/fixtures';
import { fakeEvent, runLoad } from '$lib/testing/events';

let harness: TestDb;
let db: Db;
let ada: TestUser;

beforeEach(async () => {
	harness = await createTestDb();
	db = harness.db;
	ada = await createTestUser(db, { name: 'Ada' });
});

afterEach(() => harness.close());

const at = (user: TestUser | null) =>
	Object.assign(fakeEvent({ db, user, path: '/home/rewards/history' }), { depends: () => {} });

describe('load', () => {
	test('returns the self reward claim history', async () => {
		const reward = await createTestSelfReward(db, ada, { title: 'Nap', cost: 2 });
		await setTestSelfRewardCredits(db, ada, 4);
		await claimTestSelfReward(db, ada, reward.id);

		const data = await runLoad(load(at(ada)));
		expect(data.selfRewards.claims).toContainEqual(expect.objectContaining({ rewardTitle: 'Nap' }));
	});
});
