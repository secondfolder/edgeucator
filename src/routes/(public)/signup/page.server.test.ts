import { expect, test } from 'vitest';
import { load } from './+page.server';
import { fakeEvent, runAndCatch, runLoad } from '$lib/testing/events';

// See the note in the login test: this covers only the invite round-trip.

const user = { id: 'u1', name: 'Ada', email: 'ada@example.test', image: null };

test('offers a validated redirectTo to the page', async () => {
	const data = await runLoad(
		load(fakeEvent({ db: null!, path: '/signup?redirectTo=%2Finvite%2Fabc' }))
	);
	expect(data.redirectTo).toBe('/invite/abc');
});

test('drops a redirectTo that would leave the site', async () => {
	const data = await runLoad(
		load(fakeEvent({ db: null!, path: '/signup?redirectTo=%2F%5Cevil.example' }))
	);
	expect(data.redirectTo).toBeNull();
});

test('sends an already-signed-in visitor on to their invite', async () => {
	const result = await runAndCatch(() =>
		load(fakeEvent({ db: null!, user, path: '/signup?redirectTo=%2Finvite%2Fabc' }))
	);
	expect(result).toMatchObject({ type: 'redirect', location: '/invite/abc' });
});
