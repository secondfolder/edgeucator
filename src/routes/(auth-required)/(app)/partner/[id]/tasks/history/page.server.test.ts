import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { load } from './+page.server';
import type { Db } from '$lib/server/db';
import { completePartnershipTask } from '$lib/server/tasks';
import { createTestDb, type TestDb } from '$lib/testing/db';
import {
	createTestPartnership,
	createTestPartnershipTask,
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
	ada = await createTestUser(db, { name: 'Ada', timezone: 'Europe/London' });
	jun = await createTestUser(db, { name: 'Jun', timezone: 'America/New_York' });
});

afterEach(() => harness.close());

const at = (id: string, user: TestUser | null) =>
	Object.assign(fakeEvent({ db, user, params: { id }, path: `/partner/${id}/tasks/history` }), {
		depends: () => {}
	});

describe('load', () => {
	test('returns the partnership task completion history for a member', async () => {
		const { id } = await createTestPartnership(db, ada, jun, { control: 'them' });
		const task = await createTestPartnershipTask(db, id, jun, {
			title: 'Snack',
			creditsAwarded: 2,
			completionMessages: ['Done']
		});
		await completePartnershipTask(db, {
			partnershipId: id,
			taskId: task.id,
			userId: ada.id,
			viewerTimezone: ada.timezone
		});

		const data = await runLoad(load(at(id, ada)));
		expect(data.completions).toContainEqual(
			expect.objectContaining({ taskTitle: 'Snack', mine: true, createdByMe: false })
		);
	});
});
