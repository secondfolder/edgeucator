import { afterEach, beforeEach, expect, test } from 'vitest';
import { load } from './+layout.server';
import type { Db } from '$lib/server/db';
import { createTestDb, type TestDb } from '$lib/testing/db';
import {
	createTestInvite,
	createTestPartnership,
	createTestUser,
	type TestUser
} from '$lib/testing/fixtures';
import { fakeEvent, runLoad } from '$lib/testing/events';

let harness: TestDb;
let db: Db;
let ada: TestUser;
let jun: TestUser;

beforeEach(async () => {
	harness = await createTestDb();
	db = harness.db;
	ada = await createTestUser(db, { name: 'Ada', image: '/ada.png' });
	jun = await createTestUser(db, { name: 'Jun' });
});

afterEach(() => harness.close());

test('gives the bottom nav one tab per linked partner', async () => {
	const { id } = await createTestPartnership(db, ada, jun, { partnerName: 'Jun' });
	const { partners } = await runLoad(load(fakeEvent({ db, user: ada })));
	expect(partners).toEqual([{ id, name: 'Jun', image: null }]);
});

test('uses the name and picture the viewer would recognise', async () => {
	await createTestPartnership(db, ada, jun, { yourName: 'Ada', partnerName: 'Jun' });
	const { partners } = await runLoad(load(fakeEvent({ db, user: jun })));
	expect(partners).toEqual([{ id: expect.any(String), name: 'Ada', image: '/ada.png' }]);
});

test('leaves a pending invite out of the nav', async () => {
	// A tab with nobody behind it would open an empty page and read as a bug.
	await createTestInvite(db, ada);
	const { partners } = await runLoad(load(fakeEvent({ db, user: ada })));
	expect(partners).toEqual([]);
});

test('degrades to an empty nav rather than throwing without a session', async () => {
	const { partners } = await runLoad(load(fakeEvent({ db, user: null })));
	expect(partners).toEqual([]);
});
