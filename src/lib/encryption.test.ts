import { describe, expect, it } from 'vitest';
import {
	AUTH_SECRET_LENGTH,
	AUTH_SECRET_PATTERN,
	MASTER_KEY_V1,
	MASTER_KEY_VERSIONS,
	formatSafetyNumber,
	fromBase64Url,
	masterKeySalt,
	normaliseEmail,
	pinBlocksSending,
	pinStateFor,
	safetyNumberSource,
	toBase64Url,
	wrapAad,
	type PinRecord
} from './encryption';

describe('normaliseEmail', () => {
	it('trims and lowercases', () => {
		expect(normaliseEmail('  Ada@Example.TEST ')).toBe('ada@example.test');
	});

	it('agrees for every spelling that should reach the same key', () => {
		const forms = [
			'ada@example.test',
			'ADA@EXAMPLE.TEST',
			' ada@example.test ',
			'Ada@Example.Test'
		];
		expect(new Set(forms.map(normaliseEmail)).size).toBe(1);
	});

	// Both would be defensible product behaviour, and both would silently change
	// the derived key for every existing account. Asserted absent so that nobody
	// adds them thinking they are harmless.
	it('does NOT strip gmail-style dots', () => {
		expect(normaliseEmail('a.d.a@example.test')).toBe('a.d.a@example.test');
	});

	it('does NOT strip plus-addressing', () => {
		expect(normaliseEmail('ada+sext@example.test')).toBe('ada+sext@example.test');
	});
});

describe('masterKeySalt', () => {
	it('carries the version and the normalised email', () => {
		expect(masterKeySalt(' Ada@Example.test ', MASTER_KEY_V1)).toBe(
			'bound-up-mk-v1|ada@example.test'
		);
	});

	it('differs between accounts', () => {
		expect(masterKeySalt('a@x.test', MASTER_KEY_V1)).not.toBe(
			masterKeySalt('b@x.test', MASTER_KEY_V1)
		);
	});
});

describe('MASTER_KEY_VERSIONS', () => {
	it('is newest first, so login derives against the current one', () => {
		expect(MASTER_KEY_VERSIONS[0]).toBe(MASTER_KEY_V1);
	});

	it('has no duplicate versions, or the ladder could not identify a wrap', () => {
		const versions = MASTER_KEY_VERSIONS.map((entry) => entry.version);
		expect(new Set(versions).size).toBe(versions.length);
	});

	it('meets the OWASP floor for PBKDF2-SHA256', () => {
		for (const entry of MASTER_KEY_VERSIONS) {
			if (entry.kdf === 'PBKDF2-SHA256') expect(entry.iterations).toBeGreaterThanOrEqual(600_000);
		}
	});
});

describe('base64url', () => {
	it('round-trips arbitrary bytes', () => {
		for (const length of [0, 1, 2, 3, 12, 31, 32, 48, 255]) {
			const bytes = crypto.getRandomValues(new Uint8Array(length));
			expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
		}
	});

	it('emits no padding and no +/ characters', () => {
		for (let i = 0; i < 50; i++) {
			const encoded = toBase64Url(crypto.getRandomValues(new Uint8Array(i + 1)));
			expect(encoded).toMatch(/^[A-Za-z0-9_-]*$/);
		}
	});

	// The schema checks an exact character count, so a change that reintroduced
	// padding would reject every login with a message about JavaScript.
	it('encodes 32 bytes as exactly AUTH_SECRET_LENGTH characters', () => {
		const encoded = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
		expect(encoded).toHaveLength(AUTH_SECRET_LENGTH);
		expect(encoded).toMatch(AUTH_SECRET_PATTERN);
	});

	it('rejects anything that is not base64url', () => {
		expect(() => fromBase64Url('has spaces')).toThrow(/base64url/);
		expect(() => fromBase64Url('plus+slash/')).toThrow(/base64url/);
		expect(() => fromBase64Url('padded==')).toThrow(/base64url/);
	});
});

describe('wrapAad', () => {
	it('binds a wrap to its recipient', () => {
		expect(wrapAad('age1abc')).toBe('bound-up-wrap-v1|age1abc');
		expect(wrapAad('age1abc')).not.toBe(wrapAad('age1abd'));
	});
});

describe('safetyNumberSource', () => {
	it('is symmetric, so either partner can read theirs out', () => {
		expect(safetyNumberSource('age1aaa', 'age1bbb')).toBe(safetyNumberSource('age1bbb', 'age1aaa'));
	});

	it('is domain-separated and separates the two keys', () => {
		expect(safetyNumberSource('age1aaa', 'age1bbb')).toBe('bound-up-safety-v1\nage1aaa\nage1bbb');
	});

	it('changes when either key changes', () => {
		const base = safetyNumberSource('age1aaa', 'age1bbb');
		expect(safetyNumberSource('age1aac', 'age1bbb')).not.toBe(base);
		expect(safetyNumberSource('age1aaa', 'age1bbc')).not.toBe(base);
	});
});

describe('formatSafetyNumber', () => {
	const digest = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

	it('is 16 characters in four groups of four', () => {
		const formatted = formatSafetyNumber(digest);
		expect(formatted).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
		expect(formatted.replace(/-/g, '')).toHaveLength(16);
	});

	// No I, L, O or U — that is the reason for Crockford over plain base32, and
	// it is the whole point of a number meant to be read down a phone line.
	it('contains no ambiguous letters', () => {
		for (let i = 0; i < 200; i++) {
			const formatted = formatSafetyNumber(crypto.getRandomValues(new Uint8Array(10)));
			expect(formatted).not.toMatch(/[ILOU]/);
		}
	});

	it('only reads the first 10 bytes, so digest length beyond that is irrelevant', () => {
		const longer = new Uint8Array([...digest, 99, 99, 99]);
		expect(formatSafetyNumber(longer)).toBe(formatSafetyNumber(digest));
	});

	it('refuses a digest too short to carry 80 bits', () => {
		expect(() => formatSafetyNumber(new Uint8Array(9))).toThrow(/at least 10 bytes/);
	});
});

describe('pinStateFor', () => {
	const pin = (over: Partial<PinRecord> = {}): PinRecord => ({
		partnershipId: 'p1',
		recipient: 'age1theirs',
		pinnedAt: 1000,
		verifiedAt: null,
		...over
	});

	it('is missing when they have no key yet', () => {
		expect(pinStateFor(undefined, null)).toEqual({ kind: 'missing' });
		expect(pinStateFor(pin(), null)).toEqual({ kind: 'missing' });
	});

	it('is new on first sight', () => {
		expect(pinStateFor(undefined, 'age1theirs')).toEqual({ kind: 'new' });
	});

	it('is pinned when it matches but was never compared', () => {
		expect(pinStateFor(pin(), 'age1theirs')).toEqual({ kind: 'pinned', pinnedAt: 1000 });
	});

	it('is verified when the user compared it out of band', () => {
		expect(pinStateFor(pin({ verifiedAt: 2000 }), 'age1theirs')).toEqual({
			kind: 'verified',
			verifiedAt: 2000
		});
	});

	it('is changed on a mismatch', () => {
		const record = pin();
		expect(pinStateFor(record, 'age1other')).toEqual({
			kind: 'changed',
			pinned: record,
			served: 'age1other'
		});
	});

	// Carrying verification across a key change would defeat the entire point of
	// having pinned it in the first place.
	it('does not let a verified pin survive a key change', () => {
		expect(pinStateFor(pin({ verifiedAt: 2000 }), 'age1other').kind).toBe('changed');
	});
});

describe('pinBlocksSending', () => {
	it('blocks only when there is no key or the key changed', () => {
		expect(pinBlocksSending({ kind: 'missing' })).toBe(true);
		expect(
			pinBlocksSending({
				kind: 'changed',
				pinned: { partnershipId: 'p', recipient: 'a', pinnedAt: 0, verifiedAt: null },
				served: 'b'
			})
		).toBe(true);
		// TOFU means a first sight is allowed through — that is what makes it
		// usable at all. The warning does the work, not a block.
		expect(pinBlocksSending({ kind: 'new' })).toBe(false);
		expect(pinBlocksSending({ kind: 'pinned', pinnedAt: 0 })).toBe(false);
		expect(pinBlocksSending({ kind: 'verified', verifiedAt: 0 })).toBe(false);
	});
});
