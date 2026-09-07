import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../testing/db';
import {
	createTestInvite,
	createTestMessage,
	createTestPartnership,
	createTestThread,
	createTestUser,
	readAttachmentRows,
	readMessageRows,
	readThreadReadRows,
	readThreadRow,
	type TestUser
} from '../testing/fixtures';
import { createTestMediaStore, outgoingAttachment, type TestMediaStore } from '../testing/media';
import { MAX_ATTACHMENT_TOTAL_BYTES, MAX_CIPHERTEXT_BYTES } from '../messaging';
import { attachmentKey, partnershipMediaPrefix } from './media';
import {
	applyHistoryRestore,
	clearReaction,
	declineHistoryRestore,
	getAttachmentForDownload,
	getThread,
	listBoard,
	listRestoreRequests,
	listUnreadCounts,
	markThreadOpened,
	purgePartnershipMedia,
	requestHistoryRestore,
	requireMembership,
	requireMessageMembership,
	requireThreadMembership,
	sendMessage,
	setReaction,
	startThread
} from './messaging';

let harness: TestDb;
let store: TestMediaStore;
let ada: TestUser;
let jun: TestUser;
let partnershipId: string;

const at = (ms: number) => new Date(ms);
const partnerView = (id: string) => ({ id, name: 'Jun', image: null });

beforeEach(async () => {
	harness = await createTestDb();
	store = createTestMediaStore();
	ada = await createTestUser(harness.db, { name: 'Ada' });
	jun = await createTestUser(harness.db, { name: 'Jun' });
	partnershipId = (await createTestPartnership(harness.db, ada, jun)).id;
});

afterEach(() => harness.close());

describe('requireMembership', () => {
	it('admits both members and nobody else', async () => {
		await expect(requireMembership(harness.db, partnershipId, ada.id)).resolves.toMatchObject({
			viewerId: ada.id
		});
		await expect(requireMembership(harness.db, partnershipId, jun.id)).resolves.toBeTruthy();

		const stranger = await createTestUser(harness.db);
		await expect(requireMembership(harness.db, partnershipId, stranger.id)).resolves.toBeNull();
	});

	// There is nobody to message yet, and no second recipient to encrypt to.
	it('refuses a pending invite', async () => {
		const invite = await createTestInvite(harness.db, ada);
		await expect(requireMembership(harness.db, invite.id, ada.id)).resolves.toBeNull();
	});
});

describe('the confused deputy', () => {
	/**
	 * The most likely hole this feature could ship with: being in *a*
	 * partnership is not being in *this* one, so every id from the URL is
	 * re-joined rather than trusted.
	 */
	it('refuses a thread addressed through the wrong partnership', async () => {
		const cas = await createTestUser(harness.db, { name: 'Cas' });
		const other = await createTestPartnership(harness.db, ada, cas);
		const { threadId } = await createTestThread(harness.db, partnershipId, ada);

		await expect(
			requireThreadMembership(harness.db, other.id, threadId, ada.id)
		).resolves.toBeNull();
		await expect(
			requireThreadMembership(harness.db, partnershipId, threadId, ada.id)
		).resolves.toBeTruthy();
	});

	it('refuses a message addressed through the wrong partnership', async () => {
		const cas = await createTestUser(harness.db, { name: 'Cas' });
		const other = await createTestPartnership(harness.db, ada, cas);
		const { messageId } = await createTestThread(harness.db, partnershipId, ada);

		await expect(
			requireMessageMembership(harness.db, other.id, messageId, ada.id)
		).resolves.toBeNull();
	});
});

describe('startThread', () => {
	it('writes the thread, the message and the denormalised columns together', async () => {
		const result = await startThread(
			harness.db,
			store,
			{
				partnershipId,
				senderId: ada.id,
				icon: 'bottle-droplet',
				ciphertext: 'Y2lwaGVy',
				attachments: []
			},
			at(5000)
		);
		expect(result).toMatchObject({ ok: true });
		if (!result.ok) return;

		const thread = await readThreadRow(harness.db, result.threadId);
		expect(thread).toMatchObject({
			partnershipId,
			icon: 'bottle-droplet',
			lastMessageSenderId: ada.id
		});
		expect(thread.lastMessageAt.getTime()).toBe(5000);
		await expect(readMessageRows(harness.db, result.threadId)).resolves.toHaveLength(1);
	});

	/**
	 * THE invariant the whole unread definition rests on.
	 *
	 * `isUnreadFor` treats "the newest message is mine" as "I have read this
	 * thread". That is only sound because posting writes the sender's read row
	 * in the same batch — enforced here, not by the composer being unreachable
	 * from anywhere else.
	 */
	it('marks the thread read for the sender, in the same batch', async () => {
		const { threadId } = await createTestThread(harness.db, partnershipId, ada);
		const reads = await readThreadReadRows(harness.db, threadId);
		expect(reads).toHaveLength(1);
		expect(reads[0].userId).toBe(ada.id);
	});

	it('refuses a non-member and writes nothing at all', async () => {
		const stranger = await createTestUser(harness.db);
		const result = await startThread(harness.db, store, {
			partnershipId,
			senderId: stranger.id,
			icon: 'envelope',
			ciphertext: 'eA',
			attachments: [outgoingAttachment(new Uint8Array([1, 2, 3]))]
		});

		expect(result).toEqual({ ok: false, reason: 'not-a-member' });
		// Row counts, not just the return value: a refused send must not have
		// written an object either.
		await expect(listBoard(harness.db, partnershipId, ada.id)).resolves.toEqual([]);
		expect(store.objects.size).toBe(0);
	});

	it('refuses a pending partnership', async () => {
		const invite = await createTestInvite(harness.db, ada);
		await expect(
			startThread(harness.db, store, {
				partnershipId: invite.id,
				senderId: ada.id,
				icon: 'envelope',
				ciphertext: 'eA',
				attachments: []
			})
		).resolves.toEqual({ ok: false, reason: 'not-a-member' });
	});

	// The guard that stops the one plaintext column becoming a covert channel.
	it('refuses an icon outside the closed list', async () => {
		await expect(
			startThread(harness.db, store, {
				partnershipId,
				senderId: ada.id,
				// Bypassing the type, exactly as a crafted request would.
				icon: 'a message the server can read' as never,
				ciphertext: 'eA',
				attachments: []
			})
		).resolves.toEqual({ ok: false, reason: 'bad-icon' });
		expect(await readThreadReadRows(harness.db, 'any')).toEqual([]);
	});

	it('refuses an empty or oversized body', async () => {
		for (const ciphertext of ['', 'x'.repeat(MAX_CIPHERTEXT_BYTES + 1)]) {
			await expect(
				startThread(harness.db, store, {
					partnershipId,
					senderId: ada.id,
					icon: 'envelope',
					ciphertext,
					attachments: []
				})
			).resolves.toEqual({ ok: false, reason: 'body-too-large' });
		}
	});

	it('refuses more bytes than a message may carry, without writing an object', async () => {
		const result = await startThread(harness.db, store, {
			partnershipId,
			senderId: ada.id,
			icon: 'envelope',
			ciphertext: 'eA',
			attachments: [
				{ ...outgoingAttachment(new Uint8Array(1)), byteSize: MAX_ATTACHMENT_TOTAL_BYTES },
				outgoingAttachment(new Uint8Array(1))
			]
		});
		expect(result).toEqual({ ok: false, reason: 'too-many-bytes' });
		expect(store.objects.size).toBe(0);
	});

	it('stores each attachment under a prefixed key and records its size', async () => {
		const bytes = new Uint8Array([9, 8, 7, 6]);
		const result = await startThread(harness.db, store, {
			partnershipId,
			senderId: ada.id,
			icon: 'envelope',
			ciphertext: 'eA',
			attachments: [outgoingAttachment(bytes)]
		});
		if (!result.ok) throw new Error('expected a send');

		const rows = await readAttachmentRows(harness.db, result.messageId);
		expect(rows).toHaveLength(1);
		expect(rows[0].byteSize).toBe(4);
		expect(rows[0].storageKey).toBe(attachmentKey(partnershipId, result.messageId, rows[0].id));
		expect(store.objects.get(rows[0].storageKey)).toEqual(bytes);
	});

	/**
	 * The ordering rule: objects first, rows second. A crash between them leaves
	 * an orphaned encrypted blob, which is unreadable and sweepable by prefix —
	 * rather than a row pointing at nothing, which is a permanently broken
	 * message in someone's history.
	 */
	it('leaves no rows behind when the media store fails', async () => {
		store.failNextPut = true;
		await expect(
			startThread(harness.db, store, {
				partnershipId,
				senderId: ada.id,
				icon: 'envelope',
				ciphertext: 'eA',
				attachments: [outgoingAttachment(new Uint8Array([1]))]
			})
		).rejects.toThrow(/simulated/);

		await expect(listBoard(harness.db, partnershipId, ada.id)).resolves.toEqual([]);
	});
});

describe('sendMessage', () => {
	it('advances the thread and marks it read for the sender only', async () => {
		const { threadId } = await createTestThread(harness.db, partnershipId, ada, { at: at(1000) });
		await createTestMessage(harness.db, partnershipId, threadId, jun, { at: at(2000) });

		const thread = await readThreadRow(harness.db, threadId);
		expect(thread.lastMessageAt.getTime()).toBe(2000);
		expect(thread.lastMessageSenderId).toBe(jun.id);

		const reads = await readThreadReadRows(harness.db, threadId);
		expect(reads.map((r) => r.userId).sort()).toEqual([ada.id, jun.id].sort());
		// Ada's mark is still where it was when she posted, so Jun's reply is
		// unread for her.
		const adaRead = reads.find((r) => r.userId === ada.id);
		expect(adaRead?.lastReadMessageAt.getTime()).toBe(1000);
	});

	it('distinguishes a thread that is not there from not being a member', async () => {
		const stranger = await createTestUser(harness.db);
		const { threadId } = await createTestThread(harness.db, partnershipId, ada);

		await expect(
			sendMessage(harness.db, store, {
				partnershipId,
				threadId: 'nope',
				senderId: ada.id,
				ciphertext: 'eA',
				attachments: []
			})
		).resolves.toEqual({ ok: false, reason: 'no-such-thread' });

		await expect(
			sendMessage(harness.db, store, {
				partnershipId,
				threadId,
				senderId: stranger.id,
				ciphertext: 'eA',
				attachments: []
			})
		).resolves.toEqual({ ok: false, reason: 'not-a-member' });
	});
});

describe('listBoard', () => {
	/**
	 * The whole ordering requirement in one fixture, asserted from both sides.
	 *
	 * Getting a different order for the other viewer is the point: `unread`
	 * flips per person, so this is the analogue of the `viewPartnership` tests
	 * that check the name columns from both ends.
	 */
	it('orders unread newest-first, then read most-recently-opened-first', async () => {
		// Three from Jun that Ada has not read, staggered.
		const unreadOld = await createTestThread(harness.db, partnershipId, jun, { at: at(1000) });
		const unreadMid = await createTestThread(harness.db, partnershipId, jun, { at: at(2000) });
		const unreadNew = await createTestThread(harness.db, partnershipId, jun, { at: at(3000) });
		// Two from Jun that Ada has read, opened at different times.
		const readEarly = await createTestThread(harness.db, partnershipId, jun, { at: at(500) });
		const readLate = await createTestThread(harness.db, partnershipId, jun, { at: at(600) });
		await markThreadOpened(harness.db, readEarly.threadId, ada.id, at(8000));
		await markThreadOpened(harness.db, readLate.threadId, ada.id, at(9000));
		// One Ada wrote herself, which is read for her by construction.
		const mine = await createTestThread(harness.db, partnershipId, ada, { at: at(4000) });

		const forAda = await listBoard(harness.db, partnershipId, ada.id);
		// Note where `mine` lands. Posting marks the thread read *at the time of
		// posting*, so Ada's own thread was "opened" at t=4000 — before she opened
		// the other two at 8000 and 9000. It therefore sorts below them, and that
		// is right: the read half is ordered by when you last looked at it, and
		// writing something is the last time you looked.
		expect(forAda.map((t) => t.id)).toEqual([
			unreadNew.threadId,
			unreadMid.threadId,
			unreadOld.threadId,
			readLate.threadId,
			readEarly.threadId,
			mine.threadId
		]);
		expect(forAda.slice(0, 3).every((t) => t.unread)).toBe(true);
		expect(forAda.slice(3).some((t) => t.unread)).toBe(false);

		// Jun sees the mirror image: everything Jun wrote is read, and Ada's is not.
		const forJun = await listBoard(harness.db, partnershipId, jun.id);
		expect(forJun[0].id).toBe(mine.threadId);
		expect(forJun[0].unread).toBe(true);
		expect(forJun.filter((t) => t.unread)).toHaveLength(1);
	});

	/**
	 * The left join's user predicate has to live in the ON, not the WHERE. In
	 * the WHERE it becomes an inner join and every never-opened thread vanishes
	 * from the board — which is exactly the threads the feature exists to show.
	 */
	it('includes threads the viewer has never opened', async () => {
		const { threadId } = await createTestThread(harness.db, partnershipId, jun);
		const board = await listBoard(harness.db, partnershipId, ada.id);
		expect(board.map((t) => t.id)).toEqual([threadId]);
		expect(board[0].lastOpenedAt).toBeNull();
		expect(board[0].unread).toBe(true);
	});

	it('carries the icon and the message count', async () => {
		const { threadId } = await createTestThread(harness.db, partnershipId, ada, {
			icon: 'pepper-hot'
		});
		await createTestMessage(harness.db, partnershipId, threadId, jun);
		const [sticker] = await listBoard(harness.db, partnershipId, ada.id);
		expect(sticker.icon).toBe('pepper-hot');
		expect(sticker.messageCount).toBe(2);
	});

	it('returns unread as a real boolean, never SQLite’s 0/1', async () => {
		await createTestThread(harness.db, partnershipId, jun);
		const [sticker] = await listBoard(harness.db, partnershipId, ada.id);
		expect(typeof sticker.unread).toBe('boolean');
	});

	it('shows nothing from another partnership', async () => {
		const cas = await createTestUser(harness.db, { name: 'Cas' });
		const other = await createTestPartnership(harness.db, ada, cas);
		await createTestThread(harness.db, other.id, ada);
		await expect(listBoard(harness.db, partnershipId, ada.id)).resolves.toEqual([]);
	});
});

describe('markThreadOpened', () => {
	/**
	 * `lastReadMessageAt` takes the thread's current `last_message_at`, not
	 * `now`. With `now` a message arriving in the same second as the open would
	 * be marked read without ever being seen.
	 */
	it('reads up to the newest message, not up to the clock', async () => {
		const { threadId } = await createTestThread(harness.db, partnershipId, jun, { at: at(1000) });
		await markThreadOpened(harness.db, threadId, ada.id, at(9999));

		const [read] = (await readThreadReadRows(harness.db, threadId)).filter(
			(r) => r.userId === ada.id
		);
		expect(read.lastReadMessageAt.getTime()).toBe(1000);
		expect(read.lastOpenedAt.getTime()).toBe(9999);
	});

	it('keeps the first-open time while moving the last-open time', async () => {
		const { threadId } = await createTestThread(harness.db, partnershipId, jun, { at: at(1000) });
		await markThreadOpened(harness.db, threadId, ada.id, at(2000));
		const first = (await readThreadReadRows(harness.db, threadId)).find((r) => r.userId === ada.id);
		await markThreadOpened(harness.db, threadId, ada.id, at(3000));
		const second = (await readThreadReadRows(harness.db, threadId)).find(
			(r) => r.userId === ada.id
		);

		// created_at from the timestamps helper IS "first opened".
		expect(second?.createdAt.getTime()).toBe(first?.createdAt.getTime());
		expect(second?.lastOpenedAt.getTime()).toBe(3000);
	});

	it('does nothing for a thread that is not there', async () => {
		await expect(markThreadOpened(harness.db, 'nope', ada.id)).resolves.toBeUndefined();
	});
});

describe('getThread', () => {
	it('resolves `mine` from each side and orders oldest first', async () => {
		const { threadId } = await createTestThread(harness.db, partnershipId, ada, {
			ciphertext: 'Zmlyc3Q',
			at: at(1000)
		});
		await createTestMessage(harness.db, partnershipId, threadId, jun, {
			ciphertext: 'c2Vjb25k',
			at: at(2000)
		});

		const forAda = await getThread(harness.db, threadId, 'envelope', ada.id);
		expect(forAda.messages.map((m) => m.ciphertext)).toEqual(['Zmlyc3Q', 'c2Vjb25k']);
		expect(forAda.messages.map((m) => m.mine)).toEqual([true, false]);

		const forJun = await getThread(harness.db, threadId, 'envelope', jun.id);
		expect(forJun.messages.map((m) => m.mine)).toEqual([false, true]);
	});

	it('attaches attachments and reactions to the right message', async () => {
		const { threadId, messageId } = await createTestThread(harness.db, partnershipId, ada, {
			attachments: [outgoingAttachment(new Uint8Array(3))],
			store
		});
		const reply = await createTestMessage(harness.db, partnershipId, threadId, jun);
		await setReaction(harness.db, {
			partnershipId,
			messageId: reply.messageId,
			viewerId: ada.id,
			ciphertext: 'ZW1vamk'
		});

		const thread = await getThread(harness.db, threadId, 'envelope', ada.id);
		expect(thread.messages[0].id).toBe(messageId);
		expect(thread.messages[0].attachments).toHaveLength(1);
		expect(thread.messages[0].attachments[0].byteSize).toBe(3);
		expect(thread.messages[0].reactions).toEqual([]);
		expect(thread.messages[1].reactions).toEqual([{ mine: true, ciphertext: 'ZW1vamk' }]);
		// The same reaction is "theirs" from the other side.
		const forJun = await getThread(harness.db, threadId, 'envelope', jun.id);
		expect(forJun.messages[1].reactions).toEqual([{ mine: false, ciphertext: 'ZW1vamk' }]);
	});

	it('is empty rather than failing for a thread with no messages', async () => {
		const thread = await getThread(harness.db, 'nope', 'envelope', ada.id);
		expect(thread.messages).toEqual([]);
	});
});

describe('setReaction / clearReaction', () => {
	// The requirement is reacting to messages you have *received*.
	it('refuses a reaction to your own message', async () => {
		const { messageId } = await createTestThread(harness.db, partnershipId, ada);
		await expect(
			setReaction(harness.db, { partnershipId, messageId, viewerId: ada.id, ciphertext: 'ZQ' })
		).resolves.toEqual({ ok: false, reason: 'own-message' });
	});

	it('replaces rather than appends', async () => {
		const { threadId } = await createTestThread(harness.db, partnershipId, ada);
		const reply = await createTestMessage(harness.db, partnershipId, threadId, jun);

		await setReaction(harness.db, {
			partnershipId,
			messageId: reply.messageId,
			viewerId: ada.id,
			ciphertext: 'Zmlyc3Q'
		});
		await setReaction(harness.db, {
			partnershipId,
			messageId: reply.messageId,
			viewerId: ada.id,
			ciphertext: 'c2Vjb25k'
		});

		const thread = await getThread(harness.db, threadId, 'envelope', ada.id);
		expect(thread.messages[1].reactions).toEqual([{ mine: true, ciphertext: 'c2Vjb25k' }]);
	});

	it('refuses a reaction from outside the partnership', async () => {
		const stranger = await createTestUser(harness.db);
		const { messageId } = await createTestThread(harness.db, partnershipId, ada);
		await expect(
			setReaction(harness.db, {
				partnershipId,
				messageId,
				viewerId: stranger.id,
				ciphertext: 'ZQ'
			})
		).resolves.toEqual({ ok: false, reason: 'not-a-member' });
	});

	it('clears only the viewer’s own reaction', async () => {
		const { threadId } = await createTestThread(harness.db, partnershipId, ada);
		const reply = await createTestMessage(harness.db, partnershipId, threadId, jun);
		await setReaction(harness.db, {
			partnershipId,
			messageId: reply.messageId,
			viewerId: ada.id,
			ciphertext: 'ZQ'
		});

		await expect(
			clearReaction(harness.db, { partnershipId, messageId: reply.messageId, viewerId: ada.id })
		).resolves.toEqual({ ok: true });
		const thread = await getThread(harness.db, threadId, 'envelope', ada.id);
		expect(thread.messages[1].reactions).toEqual([]);
	});
});

describe('listUnreadCounts', () => {
	it('is empty, and asks nothing, for a user with no partners', async () => {
		await expect(listUnreadCounts(harness.db, ada.id, [])).resolves.toEqual([]);
	});

	it('counts only threads whose newest message is not the viewer’s', async () => {
		await createTestThread(harness.db, partnershipId, jun, { at: at(1000) });
		await createTestThread(harness.db, partnershipId, jun, { at: at(3000) });
		await createTestThread(harness.db, partnershipId, ada, { at: at(4000) });

		const forAda = await listUnreadCounts(harness.db, ada.id, [partnerView(partnershipId)]);
		expect(forAda).toEqual([
			{
				partnershipId,
				name: 'Jun',
				image: null,
				unreadThreads: 2,
				newestAt: at(3000)
			}
		]);

		const forJun = await listUnreadCounts(harness.db, jun.id, [partnerView(partnershipId)]);
		expect(forJun[0].unreadThreads).toBe(1);
	});

	it('drops a partner once everything is read', async () => {
		const { threadId } = await createTestThread(harness.db, partnershipId, jun);
		await markThreadOpened(harness.db, threadId, ada.id);
		await expect(
			listUnreadCounts(harness.db, ada.id, [partnerView(partnershipId)])
		).resolves.toEqual([]);
	});

	it('keeps the order of the partner list it was given', async () => {
		const cas = await createTestUser(harness.db, { name: 'Cas' });
		const other = await createTestPartnership(harness.db, cas, ada);
		await createTestThread(harness.db, partnershipId, jun);
		await createTestThread(harness.db, other.id, cas);

		const ordered = await listUnreadCounts(harness.db, ada.id, [
			partnerView(other.id),
			partnerView(partnershipId)
		]);
		expect(ordered.map((r) => r.partnershipId)).toEqual([other.id, partnershipId]);
	});
});

describe('getAttachmentForDownload', () => {
	it('finds an attachment through its own partnership', async () => {
		const result = await startThread(harness.db, store, {
			partnershipId,
			senderId: ada.id,
			icon: 'envelope',
			ciphertext: 'eA',
			attachments: [outgoingAttachment(new Uint8Array([4, 5]))]
		});
		if (!result.ok) throw new Error('expected a send');
		const [row] = await readAttachmentRows(harness.db, result.messageId);

		await expect(
			getAttachmentForDownload(harness.db, partnershipId, row.id)
		).resolves.toMatchObject({ id: row.id, byteSize: 2 });
	});

	/**
	 * The confused deputy again, and the sharpest version of it: a real
	 * attachment id, addressed through a partnership the viewer genuinely
	 * belongs to. Only the re-join stops this.
	 */
	it('refuses an attachment addressed through a partnership it is not in', async () => {
		const cas = await createTestUser(harness.db, { name: 'Cas' });
		const other = await createTestPartnership(harness.db, ada, cas);
		const result = await startThread(harness.db, store, {
			partnershipId,
			senderId: ada.id,
			icon: 'envelope',
			ciphertext: 'eA',
			attachments: [outgoingAttachment(new Uint8Array([4]))]
		});
		if (!result.ok) throw new Error('expected a send');
		const [row] = await readAttachmentRows(harness.db, result.messageId);

		await expect(getAttachmentForDownload(harness.db, other.id, row.id)).resolves.toBeNull();
	});
});

describe('purgePartnershipMedia', () => {
	it('removes only that partnership’s objects', async () => {
		const cas = await createTestUser(harness.db, { name: 'Cas' });
		const other = await createTestPartnership(harness.db, ada, cas);
		for (const id of [partnershipId, other.id]) {
			await startThread(harness.db, store, {
				partnershipId: id,
				senderId: ada.id,
				icon: 'envelope',
				ciphertext: 'eA',
				attachments: [outgoingAttachment(new Uint8Array([1]))]
			});
		}
		expect(store.objects.size).toBe(2);

		await expect(purgePartnershipMedia(store, partnershipId)).resolves.toEqual({
			deleted: 1,
			failed: false
		});
		expect(
			[...store.objects.keys()].every((k) => k.startsWith(partnershipMediaPrefix(other.id)))
		).toBe(true);
	});

	// Disconnecting must never be blocked — docs/partners.md is explicit.
	it('reports a failure rather than throwing', async () => {
		const broken = {
			...store,
			deletePrefix: async () => {
				throw new Error('R2 is having a day');
			}
		};
		await expect(purgePartnershipMedia(broken, partnershipId)).resolves.toEqual({
			deleted: 0,
			failed: true
		});
	});
});

describe('history restore', () => {
	it('lets the partner re-encrypt bodies and closes the request', async () => {
		const { threadId, messageId } = await createTestThread(harness.db, partnershipId, jun, {
			ciphertext: 'b2xk'
		});

		const request = await requestHistoryRestore(harness.db, {
			partnershipId,
			requesterId: ada.id,
			recipient: 'age1newkey'
		});
		expect(request).toMatchObject({ ok: true });
		if (!request.ok) return;

		// Ada sees her own request; Jun sees it as someone else's to act on.
		await expect(listRestoreRequests(harness.db, partnershipId, ada.id)).resolves.toMatchObject([
			{ mine: true, requestedRecipient: 'age1newkey' }
		]);
		await expect(listRestoreRequests(harness.db, partnershipId, jun.id)).resolves.toMatchObject([
			{ mine: false }
		]);

		await expect(
			applyHistoryRestore(harness.db, {
				partnershipId,
				requestId: request.id,
				actorId: jun.id,
				messages: [{ id: messageId, ciphertext: 'bmV3' }],
				final: true
			})
		).resolves.toEqual({ ok: true, updated: 1 });

		const rows = await readMessageRows(harness.db, threadId);
		expect(rows[0].ciphertext).toBe('bmV3');
		await expect(listRestoreRequests(harness.db, partnershipId, ada.id)).resolves.toEqual([]);
	});

	// The person who lost their key cannot re-encrypt anything — they cannot
	// read it. Accepting their upload would let a stolen session rewrite history.
	it('refuses the requester acting on their own request', async () => {
		const { messageId } = await createTestThread(harness.db, partnershipId, jun);
		const request = await requestHistoryRestore(harness.db, {
			partnershipId,
			requesterId: ada.id,
			recipient: 'age1newkey'
		});
		if (!request.ok) return;

		await expect(
			applyHistoryRestore(harness.db, {
				partnershipId,
				requestId: request.id,
				actorId: ada.id,
				messages: [{ id: messageId, ciphertext: 'bmV3' }],
				final: true
			})
		).resolves.toEqual({ ok: false, reason: 'no-such-request' });
	});

	it('cannot be used to rewrite another partnership’s messages', async () => {
		const cas = await createTestUser(harness.db, { name: 'Cas' });
		const other = await createTestPartnership(harness.db, ada, cas);
		const elsewhere = await createTestThread(harness.db, other.id, cas, { ciphertext: 'c2FmZQ' });

		const request = await requestHistoryRestore(harness.db, {
			partnershipId,
			requesterId: ada.id,
			recipient: 'age1newkey'
		});
		if (!request.ok) return;

		await applyHistoryRestore(harness.db, {
			partnershipId,
			requestId: request.id,
			actorId: jun.id,
			messages: [{ id: elsewhere.messageId, ciphertext: 'dGFtcGVyZWQ' }],
			final: true
		});

		const rows = await readMessageRows(harness.db, elsewhere.threadId);
		expect(rows[0].ciphertext).toBe('c2FmZQ');
	});

	it('supersedes an earlier pending request from the same person', async () => {
		await requestHistoryRestore(harness.db, {
			partnershipId,
			requesterId: ada.id,
			recipient: 'age1first'
		});
		await requestHistoryRestore(harness.db, {
			partnershipId,
			requesterId: ada.id,
			recipient: 'age1second'
		});
		const open = await listRestoreRequests(harness.db, partnershipId, jun.id);
		expect(open).toHaveLength(1);
		expect(open[0].requestedRecipient).toBe('age1second');
	});

	it('lets the partner decline, and only the partner', async () => {
		const request = await requestHistoryRestore(harness.db, {
			partnershipId,
			requesterId: ada.id,
			recipient: 'age1newkey'
		});
		if (!request.ok) return;

		await expect(
			declineHistoryRestore(harness.db, {
				partnershipId,
				requestId: request.id,
				actorId: ada.id
			})
		).resolves.toBe(false);
		await expect(
			declineHistoryRestore(harness.db, {
				partnershipId,
				requestId: request.id,
				actorId: jun.id
			})
		).resolves.toBe(true);
		await expect(listRestoreRequests(harness.db, partnershipId, ada.id)).resolves.toEqual([]);
	});

	it('refuses a request from a non-member', async () => {
		const stranger = await createTestUser(harness.db);
		await expect(
			requestHistoryRestore(harness.db, {
				partnershipId,
				requesterId: stranger.id,
				recipient: 'age1x'
			})
		).resolves.toEqual({ ok: false, reason: 'not-a-member' });
	});
});
