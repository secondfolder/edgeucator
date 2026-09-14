import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { actions, load } from './+page.server';
import type { Db } from '$lib/server/db';
import { createTestDb, type TestDb } from '$lib/testing/db';
import {
	createTestInvite,
	createTestPartnership,
	createTestPartnershipTask,
	createTestUser,
	readPartnershipRewardCreditRow,
	type TestUser
} from '$lib/testing/fixtures';
import { fakeEvent, runAndCatch, runLoad } from '$lib/testing/events';

let harness: TestDb;
let db: Db;
let ada: TestUser;
let jun: TestUser;
let stranger: TestUser;

beforeEach(async () => {
	harness = await createTestDb();
	db = harness.db;
	ada = await createTestUser(db, { name: 'Ada', timezone: 'Europe/London' });
	jun = await createTestUser(db, { name: 'Jun', timezone: 'America/New_York' });
	stranger = await createTestUser(db, { name: 'Stranger', timezone: 'UTC' });
});

afterEach(() => harness.close());

const at = (id: string, user: TestUser | null, formData?: Record<string, string>) =>
	Object.assign(fakeEvent({ db, user, params: { id }, formData, path: `/partner/${id}/tasks` }), {
		depends: () => {}
	});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (name: keyof typeof actions, ...args: Parameters<any>) =>
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(actions[name] as any)(...args);

describe('load', () => {
	test('returns the partner tasks page view for a member', async () => {
		const { id } = await createTestPartnership(db, ada, jun, { control: 'them' });
		await createTestPartnershipTask(db, id, jun, {
			title: 'Treat task',
			timezoneOwnerUserId: jun.id
		});

		const data = await runLoad(load(at(id, ada)));
		expect(data).toMatchObject({
			partner: {
				id,
				name: 'Them',
				canManageTasks: false,
				canCompleteTasks: true
			}
		});
		expect(data.tasks).toContainEqual(
			expect.objectContaining({ title: 'Treat task', createdByMe: false })
		);
	});

	test('404s for a pending invite', async () => {
		const invite = await createTestInvite(db, ada);
		const result = await runAndCatch(() => runLoad(load(at(invite.id, ada))));
		expect(result).toMatchObject({ type: 'error', status: 404 });
	});

	test('404s for someone else’s partnership', async () => {
		const { id } = await createTestPartnership(db, ada, jun);
		const result = await runAndCatch(() => runLoad(load(at(id, stranger))));
		expect(result).toMatchObject({ type: 'error', status: 404 });
	});
});

describe('actions', () => {
	test('lets the completing side complete a partner task', async () => {
		const { id } = await createTestPartnership(db, ada, jun, { control: 'them' });
		const task = await createTestPartnershipTask(db, id, jun, {
			title: 'Snack',
			creditsAwarded: 2
		});

		const result = await run('completeTask', at(id, ada, { taskId: task.id }));
		expect(result).toMatchObject({ message: 'Task completed.' });
		await expect(readPartnershipRewardCreditRow(db, id, ada.id)).resolves.toMatchObject({
			credits: 2
		});
	});

	test('blocks completing your own shared-control task', async () => {
		const { id } = await createTestPartnership(db, ada, jun, { control: 'mix' });
		const task = await createTestPartnershipTask(db, id, ada, { title: 'Own task' });

		const result = await run('completeTask', at(id, ada, { taskId: task.id }));
		expect(result.status).toBe(403);
	});
});
