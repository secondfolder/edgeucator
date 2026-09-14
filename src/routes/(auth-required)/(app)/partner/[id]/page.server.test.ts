import { afterEach, beforeEach, expect, test } from 'vitest';
import { load } from './+page.server';
import type { Db } from '$lib/server/db';
import { createTestDb, type TestDb } from '$lib/testing/db';
import {
	createTestInvite,
	createTestPartnership,
	createTestUser,
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
	ada = await createTestUser(db, { name: 'Ada', image: '/ada.png', timezone: 'Europe/London' });
	jun = await createTestUser(db, { name: 'Jun', timezone: 'America/New_York' });
	stranger = await createTestUser(db);
});

afterEach(() => harness.close());

const at = (id: string, user: TestUser | null) => fakeEvent({ db, user, params: { id } });

test('shows each side their own view of the same link', async () => {
	const { id } = await createTestPartnership(db, ada, jun, {
		yourName: 'Ada',
		partnerName: 'Jun',
		partnerRole: 'sub',
		yourRole: 'dom',
		control: 'me'
	});

	expect((await runLoad(load(at(id, ada)))).partner).toEqual({
		id,
		name: 'Jun',
		yourName: 'Ada',
		image: null,
		timezone: 'America/New_York',
		partnerRole: 'sub',
		yourRole: 'dom',
		canEdit: true
	});

	expect((await runLoad(load(at(id, jun)))).partner).toEqual({
		id,
		name: 'Ada',
		yourName: 'Jun',
		image: '/ada.png',
		timezone: 'Europe/London',
		partnerRole: 'dom',
		yourRole: 'sub',
		canEdit: false
	});
});

test('404s for a pending invite — there is nobody there yet', async () => {
	const invite = await createTestInvite(db, ada);
	const result = await runAndCatch(() => runLoad(load(at(invite.id, ada))));
	expect(result).toMatchObject({ type: 'error', status: 404 });
});

test('404s for someone else’s partnership', async () => {
	const { id } = await createTestPartnership(db, ada, jun);
	const result = await runAndCatch(() => runLoad(load(at(id, stranger))));
	expect(result).toMatchObject({ type: 'error', status: 404 });
});

test('401s without a session', async () => {
	const { id } = await createTestPartnership(db, ada, jun);
	const result = await runAndCatch(() => runLoad(load(at(id, null))));
	expect(result).toMatchObject({ type: 'error', status: 401 });
});
