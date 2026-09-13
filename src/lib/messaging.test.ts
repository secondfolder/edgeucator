import { describe, expect, it } from 'vitest';
import {
	BOARD_LIMIT,
	DEFAULT_THREAD_ICON,
	MAX_ATTACHMENT_TOTAL_BYTES,
	MAX_VIDEO_BYTES,
	THREAD_ICONS,
	compareBoardThreads,
	isThreadIcon,
	isUnreadFor,
	type BoardThread
} from './messaging';

const at = (ms: number) => new Date(ms);

describe('THREAD_ICONS', () => {
	it('has no duplicates', () => {
		expect(new Set(THREAD_ICONS).size).toBe(THREAD_ICONS.length);
	});

	it('includes the default', () => {
		expect(THREAD_ICONS).toContain(DEFAULT_THREAD_ICON);
	});

	// The picker is a 4x4 grid; a count that is not a multiple of four leaves a
	// ragged last row.
	it('fills whole rows of four', () => {
		expect(THREAD_ICONS.length % 4).toBe(0);
	});

	// These land in a `wa-icon name=` attribute and, on the local store, in an
	// object key. Anything outside this shape is a bug waiting to happen.
	it('are all plain lowercase kebab-case names', () => {
		for (const icon of THREAD_ICONS) expect(icon).toMatch(/^[a-z]+(-[a-z]+)*$/);
	});
});

describe('isThreadIcon', () => {
	it('accepts every member of the list', () => {
		for (const icon of THREAD_ICONS) expect(isThreadIcon(icon)).toBe(true);
	});

	// This is the guard that keeps the one plaintext column from becoming a
	// covert channel for arbitrary prose.
	it('rejects everything else', () => {
		for (const value of [
			'',
			'ENVELOPE',
			'envelope ',
			'../../etc/passwd',
			'a message the server can read',
			'heart; drop table',
			null,
			undefined,
			42,
			{},
			['heart']
		]) {
			expect(isThreadIcon(value)).toBe(false);
		}
	});
});

describe('caps', () => {
	it('keeps a single video below the whole-message budget', () => {
		expect(MAX_VIDEO_BYTES).toBeLessThan(MAX_ATTACHMENT_TOTAL_BYTES);
	});

	it('keeps the message budget well inside a Worker isolate', () => {
		// 128 MB isolate, and request.formData() buffers the whole body.
		expect(MAX_ATTACHMENT_TOTAL_BYTES).toBeLessThanOrEqual(32 * 1024 * 1024);
	});

	it('keeps a board inside one query', () => {
		expect(BOARD_LIMIT).toBeGreaterThan(0);
	});
});

describe('isUnreadFor', () => {
	const me = 'me';
	const them = 'them';

	it('is unread when they wrote and I have never opened it', () => {
		expect(
			isUnreadFor(
				{ lastMessageAt: at(100), lastMessageSenderId: them, lastReadMessageAt: null },
				me
			)
		).toBe(true);
	});

	it('is unread when they wrote after I last read', () => {
		expect(
			isUnreadFor(
				{ lastMessageAt: at(200), lastMessageSenderId: them, lastReadMessageAt: at(100) },
				me
			)
		).toBe(true);
	});

	// The boundary that decides whether reopening a thread flickers back to
	// unread. `>` not `>=`.
	it('is read when my read mark equals the newest message', () => {
		expect(
			isUnreadFor(
				{ lastMessageAt: at(200), lastMessageSenderId: them, lastReadMessageAt: at(200) },
				me
			)
		).toBe(false);
	});

	it('is read when I read past it', () => {
		expect(
			isUnreadFor(
				{ lastMessageAt: at(100), lastMessageSenderId: them, lastReadMessageAt: at(200) },
				me
			)
		).toBe(false);
	});

	// Sound only because sendMessage() upserts the sender's thread_reads row in
	// the same batch. That invariant has its own server test.
	it('is read when the newest message is mine, whatever the read mark says', () => {
		expect(
			isUnreadFor({ lastMessageAt: at(999), lastMessageSenderId: me, lastReadMessageAt: null }, me)
		).toBe(false);
	});

	it('flips with the viewer', () => {
		const thread = {
			lastMessageAt: at(200),
			lastMessageSenderId: them,
			lastReadMessageAt: null
		};
		expect(isUnreadFor(thread, me)).toBe(true);
		expect(isUnreadFor(thread, them)).toBe(false);
	});
});

describe('compareBoardThreads', () => {
	const thread = (over: Partial<BoardThread> & { id: string }): BoardThread => ({
		unread: false,
		lastMessageAt: at(0),
		lastFullyReadAt: null,
		...over
	});

	it('puts every unread thread above every read one', () => {
		const board = [
			thread({ id: 'read-recent', lastFullyReadAt: at(9000) }),
			thread({ id: 'unread-old', unread: true, lastMessageAt: at(1) })
		];
		expect(board.sort(compareBoardThreads).map((t) => t.id)).toEqual(['unread-old', 'read-recent']);
	});

	it('orders unread newest-first', () => {
		const board = [
			thread({ id: 'b', unread: true, lastMessageAt: at(200) }),
			thread({ id: 'c', unread: true, lastMessageAt: at(100) }),
			thread({ id: 'a', unread: true, lastMessageAt: at(300) })
		];
		expect(board.sort(compareBoardThreads).map((t) => t.id)).toEqual(['a', 'b', 'c']);
	});

	it('orders read by most recently opened', () => {
		const board = [
			thread({ id: 'yesterday', lastFullyReadAt: at(200) }),
			thread({ id: 'last-month', lastFullyReadAt: at(100) }),
			thread({ id: 'just-now', lastFullyReadAt: at(300) })
		];
		expect(board.sort(compareBoardThreads).map((t) => t.id)).toEqual([
			'just-now',
			'yesterday',
			'last-month'
		]);
	});

	// Read threads sort on when they were OPENED, not on when they last got a
	// message — that is the whole difference between the two halves.
	it('ignores lastMessageAt for read threads', () => {
		const board = [
			thread({ id: 'newer-message', lastMessageAt: at(9000), lastFullyReadAt: at(100) }),
			thread({ id: 'older-message', lastMessageAt: at(1), lastFullyReadAt: at(200) })
		];
		expect(board.sort(compareBoardThreads).map((t) => t.id)).toEqual([
			'older-message',
			'newer-message'
		]);
	});

	it('breaks a shared millisecond on id rather than leaving it unstable', () => {
		const board = [
			thread({ id: 'zzz', unread: true, lastMessageAt: at(100) }),
			thread({ id: 'aaa', unread: true, lastMessageAt: at(100) })
		];
		expect(board.sort(compareBoardThreads).map((t) => t.id)).toEqual(['aaa', 'zzz']);
	});

	// Cannot happen by construction, but an ordering function is the wrong place
	// to discover a data problem.
	it('sorts a read thread with no open time last instead of throwing', () => {
		const board = [
			thread({ id: 'never-opened', lastFullyReadAt: null }),
			thread({ id: 'opened', lastFullyReadAt: at(100) })
		];
		expect(board.sort(compareBoardThreads).map((t) => t.id)).toEqual(['opened', 'never-opened']);
	});

	it('is a total order — sorting twice changes nothing', () => {
		const board: BoardThread[] = Array.from({ length: 40 }, (_, i) =>
			thread({
				id: `t${String(i).padStart(2, '0')}`,
				unread: i % 3 === 0,
				lastMessageAt: at((i * 7) % 11),
				lastFullyReadAt: i % 5 === 0 ? null : at((i * 13) % 17)
			})
		);
		const once = [...board].sort(compareBoardThreads).map((t) => t.id);
		const twice = [...board]
			.sort(compareBoardThreads)
			.sort(compareBoardThreads)
			.map((t) => t.id);
		expect(twice).toEqual(once);
	});
});
