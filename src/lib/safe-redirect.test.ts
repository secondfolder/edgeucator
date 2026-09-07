import { describe, expect, test } from 'vitest';
import { redirectTargetOrHome, safeRedirect } from './safe-redirect';

describe('safeRedirect', () => {
	test('accepts an ordinary in-app path', () => {
		expect(safeRedirect('/invite/abc123')).toBe('/invite/abc123');
		expect(safeRedirect('/home?x=1#y')).toBe('/home?x=1#y');
	});

	test('rejects an absolute URL', () => {
		expect(safeRedirect('https://evil.example/steal')).toBeNull();
		expect(safeRedirect('http://evil.example')).toBeNull();
		expect(safeRedirect('javascript:alert(1)')).toBeNull();
	});

	test('rejects a protocol-relative URL', () => {
		// Browsers read both of these as "go to evil.example", even though they
		// start with a slash — this is the case a naive startsWith('/') misses.
		expect(safeRedirect('//evil.example/steal')).toBeNull();
		expect(safeRedirect('/\\evil.example/steal')).toBeNull();
	});

	test('rejects a bare relative path', () => {
		expect(safeRedirect('home')).toBeNull();
		expect(safeRedirect('../home')).toBeNull();
	});

	test('treats nothing as nothing', () => {
		expect(safeRedirect(null)).toBeNull();
		expect(safeRedirect(undefined)).toBeNull();
		expect(safeRedirect('')).toBeNull();
	});

	test('allows a lone slash', () => {
		expect(safeRedirect('/')).toBe('/');
	});
});

describe('redirectTargetOrHome', () => {
	test('passes a safe path through', () => {
		expect(redirectTargetOrHome('/invite/abc')).toBe('/invite/abc');
	});

	test('falls back to /home for anything else', () => {
		expect(redirectTargetOrHome('//evil.example')).toBe('/home');
		expect(redirectTargetOrHome(null)).toBe('/home');
	});
});
