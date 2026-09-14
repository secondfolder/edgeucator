import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { load } from './+page.server';
import type { Db } from '$lib/server/db';
import { completeSelfTask } from '$lib/server/tasks';
import { createTestDb, type TestDb } from '$lib/testing/db';
import { createTestSelfTask, createTestUser, type TestUser } from '$lib/testing/fixtures';
import { fakeEvent, runLoad } from '$lib/testing/events';

let harness: TestDb;
let db: Db;
let ada: TestUser;

beforeEach(async () => {
	harness = await createTestDb();
	db = harness.db;
	ada = await createTestUser(db, { name: 'Ada', timezone: 'Europe/London' });
});

afterEach(() => harness.close());

const at = (user: TestUser | null) =>
	Object.assign(fakeEvent({ db, user, path: '/home/tasks/history' }), { depends: () => {} });

describe('load', () => {
	test('returns the self task completion history', async () => {
		const task = await createTestSelfTask(db, ada, {
			title: 'Nap',
			creditsAwarded: 2,
			completionMessages: ['Done']
		});
		await completeSelfTask(db, ada.id, ada.timezone, task.id);

		const data = await runLoad(load(at(ada)));
		expect(data.selfTasks.completions).toContainEqual(
			expect.objectContaining({ taskTitle: 'Nap', creditsAwarded: 2 })
		);
	});
});
