import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '$lib/testing/db';
import {
	createTestPartnership,
	createTestThread,
	createTestUser,
	type TestUser
} from '$lib/testing/fixtures';
import { fakeEvent, runAndCatch, runLoad } from '$lib/testing/events';
import { load } from './+page.server';

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

	it('reports no message history on a bare account', async () => {
		const data = await runLoad(load(fakeEvent({ db: harness.db, user: ada })));
		expect(data.hasMessageHistory).toBe(false);
	});

	it('does not count a linked partner with no thread history', async () => {
		const jun = await createTestUser(harness.db, { name: 'Jun' });
		await createTestPartnership(harness.db, ada, jun);

		const data = await runLoad(load(fakeEvent({ db: harness.db, user: ada })));
		expect(data.hasMessageHistory).toBe(false);
	});

	it('reports message history once a thread exists', async () => {
		const jun = await createTestUser(harness.db, { name: 'Jun' });
		const partnership = await createTestPartnership(harness.db, ada, jun);
		await createTestThread(harness.db, partnership.id, ada);

		const data = await runLoad(load(fakeEvent({ db: harness.db, user: ada })));
		expect(data.hasMessageHistory).toBe(true);
	});
});
