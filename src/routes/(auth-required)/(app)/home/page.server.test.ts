import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { load } from './+page.server';
import type { Db } from '$lib/server/db';
import { createTestDb, type TestDb } from '$lib/testing/db';
import {
	createTestPartnership,
	createTestThread,
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
	ada = await createTestUser(db, { name: 'Ada' });
	jun = await createTestUser(db, { name: 'Jun' });
});

afterEach(() => harness.close());

function at(
	user: TestUser | null,
	partners = [] as { id: string; name: string; image: string | null }[]
) {
	return Object.assign(fakeEvent({ db, user, path: '/home' }), {
		depends: () => {},
		parent: async () => ({ partners })
	});
}

describe('load', () => {
	test('returns unread partner links from the layout partner list', async () => {
		const { id } = await createTestPartnership(db, ada, jun, { control: 'them' });
		await createTestThread(db, id, jun, { at: new Date('2026-09-13T12:00:00Z') });

		const data = await runLoad(load(at(ada, [{ id, name: 'Jun', image: null }])));
		expect(data.unread).toContainEqual(
			expect.objectContaining({
				partnershipId: id,
				name: 'Jun',
				unreadThreads: 1
			})
		);
	});

	test('degrades to an empty home feed without a session', async () => {
		await expect(runLoad(load(at(null)))).resolves.toEqual({ unread: [] });
	});
});
