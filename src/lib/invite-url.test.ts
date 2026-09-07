import { expect, test } from 'vitest';
import { inviteUrl } from './invite-url';

test('builds an absolute URL on the request origin', () => {
	expect(inviteUrl('https://app.example', 'abc123')).toBe('https://app.example/invite/abc123');
});

test('works on a non-default port, as local dev uses', () => {
	expect(inviteUrl('http://localhost:5173', 'abc')).toBe('http://localhost:5173/invite/abc');
});

test('escapes a token so base64url padding or slashes cannot alter the path', () => {
	expect(inviteUrl('https://app.example', 'a/b+c=')).toBe(
		'https://app.example/invite/a%2Fb%2Bc%3D'
	);
});
