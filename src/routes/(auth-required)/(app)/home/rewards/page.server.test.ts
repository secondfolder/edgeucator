import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { actions, load } from './+page.server';
import type { Db } from '$lib/server/db';
import { createTestDb, type TestDb } from '$lib/testing/db';
import {
	createTestPartnership,
	createTestPartnershipReward,
	createTestSelfReward,
	createTestUser,
	readPartnershipRewardClaimRows,
	readSelfRewardCreditRow,
	readSelfRewardRow,
	setTestPartnershipRewardCredits,
	setTestSelfRewardCredits,
	type TestUser
} from '$lib/testing/fixtures';
import { fakeEvent, runAndCatch, runLoad } from '$lib/testing/events';
import type { SelfRewardView } from '$lib/types';

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

function at(
	user: TestUser | null,
	formData?: Record<string, string>,
	partners = [] as { id: string; name: string; image: string | null }[]
) {
	return Object.assign(fakeEvent({ db, user, formData, path: '/home/rewards' }), {
		depends: () => {},
		parent: async () => ({ partners })
	});
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (name: keyof typeof actions, ...args: Parameters<any>) =>
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(actions[name] as any)(...args);

describe('load', () => {
	test('returns self rewards and partner sections', async () => {
		const { id } = await createTestPartnership(db, ada, jun, { control: 'them' });
		await createTestSelfReward(db, ada, { title: 'Self treat', cost: 1 });
		await setTestSelfRewardCredits(db, ada, 3);
		await createTestPartnershipReward(db, id, jun, { title: 'Partner treat', cost: 2 });
		await setTestPartnershipRewardCredits(db, id, jun, ada, 4);

		const data = await runLoad(load(at(ada, undefined, [{ id, name: 'Jun', image: null }])));
		expect(data.selfRewards).toMatchObject({ credits: 3 });
		expect(data.selfRewards.rewards).toContainEqual(
			expect.objectContaining({ title: 'Self treat', canClaim: true })
		);
		expect(data.partnerRewards).toContainEqual(
			expect.objectContaining({
				partnershipId: id,
				name: 'Jun',
				rewards: [expect.objectContaining({ title: 'Partner treat', canClaim: true })]
			})
		);
	});

	test('includes an empty section for a partner with no claimable rewards', async () => {
		const { id } = await createTestPartnership(db, ada, jun, { control: 'them' });
		const data = await runLoad(load(at(ada, undefined, [{ id, name: 'Jun', image: null }])));
		expect(data.partnerRewards).toContainEqual(
			expect.objectContaining({ partnershipId: id, name: 'Jun', rewards: [] })
		);
	});

	test('omits a controller-only partnership from the claimable partner sections', async () => {
		const { id } = await createTestPartnership(db, ada, jun, { control: 'me' });
		await createTestPartnershipReward(db, id, ada, { title: 'Tea', cost: 2 });

		const data = await runLoad(load(at(ada, undefined, [{ id, name: 'Jun', image: null }])));
		expect(data.partnerRewards).toEqual([]);
	});

	test('degrades to an empty rewards page without a session', async () => {
		await expect(runLoad(load(at(null)))).resolves.toEqual({
			selfRewards: { credits: 0, rewards: [], claims: [] },
			partnerRewards: []
		});
	});
});

describe('actions', () => {
	test('updates a self reward from the rewards hub', async () => {
		await createTestSelfReward(db, ada, { title: 'Bath', description: 'Long soak', cost: 2 });
		const section = await runLoad(load(at(ada)));
		const reward = section.selfRewards.rewards.find(
			(entry: SelfRewardView) => entry.title === 'Bath'
		);
		if (!reward) throw new Error('reward not created');

		await run(
			'selfUpdateReward',
			at(ada, {
				rewardId: reward.id,
				title: 'Bath time',
				description: 'Hot bath',
				cost: '3',
				active: 'on'
			})
		);

		await expect(readSelfRewardRow(db, reward.id)).resolves.toMatchObject({
			title: 'Bath time',
			cost: 3
		});
	});

	test('claims a self reward and deducts credits', async () => {
		const reward = await createTestSelfReward(db, ada, { title: 'Nap', cost: 2 });
		await setTestSelfRewardCredits(db, ada, 5);

		const result = await run('selfClaimReward', at(ada, { rewardId: reward.id }));
		expect(result).toMatchObject({ message: 'Reward claimed.' });
		await expect(readSelfRewardCreditRow(db, ada.id)).resolves.toMatchObject({ credits: 3 });
	});

	test('claims a partner reward from the rewards hub', async () => {
		const { id } = await createTestPartnership(db, ada, jun, { control: 'them' });
		const reward = await createTestPartnershipReward(db, id, jun, { title: 'Tea', cost: 2 });
		await setTestPartnershipRewardCredits(db, id, jun, ada, 4);

		const result = await run(
			'partnerClaimReward',
			at(ada, { partnershipId: id, rewardId: reward.id }, [{ id, name: 'Jun', image: null }])
		);
		expect(result).toMatchObject({ message: 'Reward claimed.' });
		await expect(readPartnershipRewardClaimRows(db, id)).resolves.toContainEqual(
			expect.objectContaining({ rewardId: reward.id, claimedByUserId: ada.id })
		);
	});

	test('401s without a session when an action runs', async () => {
		const result = await runAndCatch(() => run('selfSetCredits', at(null, { credits: '1' })));
		expect(result).toMatchObject({ type: 'error', status: 401 });
	});
});
