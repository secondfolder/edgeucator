import { afterEach, beforeEach, expect, test } from 'vitest';
import { load } from './+page.server';
import type { Db } from '$lib/server/db';
import type { PartnershipView } from '$lib/partnership';
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

beforeEach(async () => {
	harness = await createTestDb();
	db = harness.db;
	ada = await createTestUser(db, { name: 'Ada' });
	jun = await createTestUser(db, { name: 'Jun' });
});

afterEach(() => harness.close());

test('lists both linked partners and outstanding invites', async () => {
	await createTestPartnership(db, ada, jun, { partnerName: 'Jun' });
	await createTestInvite(db, ada, { partnerName: 'Kit' });

	const { partnerships } = await runLoad(load(fakeEvent({ db, user: ada })));

	expect(partnerships).toHaveLength(2);
	expect(partnerships.find((p: PartnershipView) => p.status === 'accepted')?.partnerName).toBe(
		'Jun'
	);
	expect(partnerships.find((p: PartnershipView) => p.status === 'pending')?.partnerName).toBe(
		'Kit'
	);
});

test('shows nothing to a user with no partners', async () => {
	await createTestPartnership(db, ada, jun);
	const other = await createTestUser(db);
	const { partnerships } = await runLoad(load(fakeEvent({ db, user: other })));
	expect(partnerships).toEqual([]);
});

test('never leaks the invite token into page data', async () => {
	// Load data is serialised into the HTML of the page; the list has no need
	// for the token and the detail page is where it is deliberately exposed.
	await createTestInvite(db, ada);
	const { partnerships } = await runLoad(load(fakeEvent({ db, user: ada })));
	expect(JSON.stringify(partnerships)).not.toMatch(/inviteToken/);
});

test('refuses to run without a session', async () => {
	// Layout loads run before page loads, so the group guard has already fired
	// in production — but the check is what makes that a guarantee rather than
	// an assumption.
	const result = await runAndCatch(() => runLoad(load(fakeEvent({ db, user: null }))));
	expect(result).toMatchObject({ type: 'error', status: 401 });
});
