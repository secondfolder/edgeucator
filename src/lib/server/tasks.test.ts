import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { partnerships } from './db/schema';
import { createTestDb, type TestDb } from '../testing/db';
import {
	readPartnershipRewardCreditRow,
	createTestInvite,
	createTestPartnership,
	createTestPartnershipTask,
	createTestSelfTask,
	createTestUser,
	readSelfRewardCreditRow,
	readPartnershipTaskRow,
	readSelfTaskRow,
	type TestUser
} from '../testing/fixtures';
import {
	completePartnershipTask,
	completeSelfTask,
	createPartnershipTask,
	getPartnershipTasksPage,
	getSelfTaskForUser,
	getSelfTasksSection,
	listHomePartnerTaskSections,
	requireTaskMembership
} from './tasks';

let harness: TestDb;
let ada: TestUser;
let jun: TestUser;

beforeEach(async () => {
	harness = await createTestDb();
	ada = await createTestUser(harness.db, { name: 'Ada', timezone: 'Europe/London' });
	jun = await createTestUser(harness.db, { name: 'Jun', timezone: 'America/New_York' });
});

afterEach(() => harness.close());

describe('requireTaskMembership', () => {
	it('admits both members and nobody else', async () => {
		const partnershipId = (await createTestPartnership(harness.db, ada, jun)).id;
		await expect(
			requireTaskMembership(harness.db, partnershipId, ada.id, ada.timezone)
		).resolves.toMatchObject({ viewerId: ada.id, counterpartUserId: jun.id });
		await expect(
			requireTaskMembership(harness.db, partnershipId, jun.id, jun.timezone)
		).resolves.toMatchObject({ viewerId: jun.id, counterpartUserId: ada.id });

		const stranger = await createTestUser(harness.db, { name: 'Stranger' });
		await expect(
			requireTaskMembership(harness.db, partnershipId, stranger.id, stranger.timezone)
		).resolves.toBeNull();
	});

	it('refuses a pending invite', async () => {
		const invite = await createTestInvite(harness.db, ada);
		await expect(
			requireTaskMembership(harness.db, invite.id, ada.id, ada.timezone)
		).resolves.toBeNull();
	});
});

describe('self tasks', () => {
	it('creates and lists a self task with owner-relative timezone handling', async () => {
		const { id } = await createTestSelfTask(harness.db, ada, {
			title: 'Morning task',
			completionMessages: ['One', 'Two']
		});

		await expect(readSelfTaskRow(harness.db, id)).resolves.toMatchObject({
			ownerId: ada.id,
			timezoneOwnerUserId: ada.id,
			title: 'Morning task'
		});

		const section = await getSelfTasksSection(harness.db, ada.id, ada.timezone);
		expect(section.tasks).toContainEqual(
			expect.objectContaining({
				id,
				title: 'Morning task',
				canComplete: true,
				timeZoneNote: null,
				completionMessages: ['One', 'Two']
			})
		);
	});

	it('completes a one-off self task, awards credits, and deactivates it', async () => {
		const { id } = await createTestSelfTask(harness.db, ada, {
			title: 'Solo task',
			creditsAwarded: 4,
			completionMessages: ['Well done']
		});

		await expect(completeSelfTask(harness.db, ada.id, ada.timezone, id)).resolves.toEqual({
			ok: true
		});
		await expect(readSelfRewardCreditRow(harness.db, ada.id)).resolves.toMatchObject({
			credits: 4
		});
		await expect(readSelfTaskRow(harness.db, id)).resolves.toMatchObject({
			active: false,
			completedCount: 1
		});

		const task = await getSelfTaskForUser(harness.db, ada.id, ada.timezone, id);
		expect(task).toMatchObject({ canComplete: false, active: false });
	});
});

describe('partnership tasks', () => {
	it('lets the controller create tasks and rejects an invalid timezone owner', async () => {
		const controlled = (await createTestPartnership(harness.db, ada, jun, { control: 'me' })).id;

		await expect(
			createPartnershipTask(harness.db, controlled, ada.id, ada.timezone, {
				title: 'Partner task',
				description: 'Do something',
				active: true,
				creditsAwarded: 3,
				completionMessages: ['Done'],
				schedule: { mode: 'one-off' },
				timezoneOwnerUserId: jun.id
			})
		).resolves.toMatchObject({ ok: true });

		const stranger = await createTestUser(harness.db, { name: 'Stranger' });
		await expect(
			createPartnershipTask(harness.db, controlled, ada.id, ada.timezone, {
				title: 'Bad task',
				description: null,
				active: true,
				creditsAwarded: 1,
				completionMessages: ['Nope'],
				schedule: { mode: 'one-off' },
				timezoneOwnerUserId: stranger.id
			})
		).resolves.toEqual({ ok: false, reason: 'bad-timezone-owner' });
	});

	it('rejects creation by the non-controller under one-sided control', async () => {
		const controlled = (await createTestPartnership(harness.db, ada, jun, { control: 'me' })).id;

		await expect(
			createPartnershipTask(harness.db, controlled, jun.id, jun.timezone, {
				title: 'Nope',
				description: null,
				active: true,
				creditsAwarded: 1,
				completionMessages: ['Nope'],
				schedule: { mode: 'one-off' },
				timezoneOwnerUserId: ada.id
			})
		).resolves.toEqual({ ok: false, reason: 'forbidden' });
	});

	it('returns viewer-facing task data for the partner page with timezone note metadata', async () => {
		const claimantView = (await createTestPartnership(harness.db, ada, jun, { control: 'them' }))
			.id;
		const anchor = '2026-09-20T10:00';
		const { id } = await createTestPartnershipTask(harness.db, claimantView, jun, {
			title: 'Jun task',
			schedule: {
				mode: 'scheduled',
				anchorLocal: anchor,
				frequency: 'week',
				interval: 1,
				weekdays: ['su'],
				end: { kind: 'never' }
			},
			timezoneOwnerUserId: jun.id
		});

		const page = await getPartnershipTasksPage(harness.db, claimantView, ada.id, ada.timezone);
		expect(page).toMatchObject({
			partner: {
				id: claimantView,
				name: 'Them',
				canManageTasks: false,
				canCompleteTasks: true,
				counterpartUserId: jun.id,
				counterpartTimezone: jun.timezone
			}
		});
		expect(page?.tasks).toContainEqual(
			expect.objectContaining({
				id,
				createdByMe: false,
				canManage: false,
				canComplete: false,
				timeZoneNote: {
					timeZone: jun.timezone,
					referenceTimeZone: ada.timezone,
					date: expect.any(Date),
					showCurrentTime: false
				}
			})
		);
	});

	it('omits the timezone note for one-off partner tasks with no task-local date', async () => {
		const claimantView = (await createTestPartnership(harness.db, ada, jun, { control: 'them' }))
			.id;
		const { id } = await createTestPartnershipTask(harness.db, claimantView, jun, {
			title: 'One-off partner task',
			schedule: { mode: 'one-off' },
			timezoneOwnerUserId: jun.id
		});

		const page = await getPartnershipTasksPage(harness.db, claimantView, ada.id, ada.timezone);
		expect(page?.tasks).toContainEqual(
			expect.objectContaining({
				id,
				timeZoneNote: null
			})
		);
	});

	it('awards credits to the completer and deactivates a one-off partnership task', async () => {
		const claimantView = (await createTestPartnership(harness.db, ada, jun, { control: 'them' }))
			.id;
		const { id } = await createTestPartnershipTask(harness.db, claimantView, jun, {
			title: 'Jun task',
			creditsAwarded: 5,
			completionMessages: ['Completed']
		});

		await expect(
			completePartnershipTask(harness.db, {
				partnershipId: claimantView,
				taskId: id,
				userId: ada.id,
				viewerTimezone: ada.timezone
			})
		).resolves.toEqual({ ok: true });

		await expect(
			readPartnershipRewardCreditRow(harness.db, claimantView, ada.id)
		).resolves.toMatchObject({
			credits: 5
		});
		await expect(readPartnershipTaskRow(harness.db, id)).resolves.toMatchObject({
			active: false,
			completedCount: 1
		});
	});

	it('blocks the author from completing their own task under shared control', async () => {
		const shared = (await createTestPartnership(harness.db, ada, jun, { control: 'mix' })).id;
		const { id } = await createTestPartnershipTask(harness.db, shared, ada, {
			title: 'Ada task'
		});

		await expect(
			completePartnershipTask(harness.db, {
				partnershipId: shared,
				taskId: id,
				userId: ada.id,
				viewerTimezone: ada.timezone
			})
		).resolves.toEqual({ ok: false, reason: 'own-task' });
	});

	it('hides tasks that are no longer on the viewer side after control changes', async () => {
		const shared = (await createTestPartnership(harness.db, ada, jun, { control: 'mix' })).id;
		const fromJun = await createTestPartnershipTask(harness.db, shared, jun, {
			title: 'Jun assigned this to Ada'
		});
		const fromAda = await createTestPartnershipTask(harness.db, shared, ada, {
			title: 'Ada assigned this to Jun'
		});

		await harness.db
			.update(partnerships)
			.set({ control: 'inviter' })
			.where(and(eq(partnerships.id, shared), eq(partnerships.inviterId, ada.id)));

		const page = await getPartnershipTasksPage(harness.db, shared, ada.id, ada.timezone);
		expect(page?.tasks).toContainEqual(
			expect.objectContaining({ id: fromAda.id, title: 'Ada assigned this to Jun' })
		);
		expect(page?.tasks).not.toContainEqual(
			expect.objectContaining({ id: fromJun.id, title: 'Jun assigned this to Ada' })
		);
		await expect(readPartnershipTaskRow(harness.db, fromJun.id)).resolves.toBeTruthy();
	});
});

describe('home tasks aggregation', () => {
	it('orders sections by the incoming partner order and shows only counterpart-authored active tasks', async () => {
		const cas = await createTestUser(harness.db, { name: 'Cas', timezone: 'Australia/Sydney' });
		const pat = await createTestUser(harness.db, { name: 'Pat', timezone: 'UTC' });
		const withJun = (await createTestPartnership(harness.db, ada, jun, { control: 'them' })).id;
		const withCas = (await createTestPartnership(harness.db, ada, cas, { control: 'mix' })).id;
		const withPat = (await createTestPartnership(harness.db, ada, pat, { control: 'me' })).id;

		await createTestPartnershipTask(harness.db, withJun, jun, { title: 'Jun task' });
		await createTestPartnershipTask(harness.db, withCas, cas, { title: 'Cas task' });
		await createTestPartnershipTask(harness.db, withCas, ada, { title: 'Ada task in Cas' });
		await createTestPartnershipTask(harness.db, withPat, ada, { title: 'Ada task in Pat' });

		const sections = await listHomePartnerTaskSections(harness.db, ada.id, ada.timezone, [
			{ id: withCas, name: 'Cas', image: null },
			{ id: withJun, name: 'Jun', image: null },
			{ id: withPat, name: 'Pat', image: null }
		]);

		expect(sections.map((section) => section.name)).toEqual(['Cas', 'Jun']);
		expect(sections[0]?.tasks).toContainEqual(
			expect.objectContaining({ title: 'Cas task', createdByMe: false })
		);
		expect(sections[0]?.tasks).toHaveLength(1);
		expect(sections[1]?.tasks).toContainEqual(
			expect.objectContaining({ title: 'Jun task', createdByMe: false })
		);
	});
});
