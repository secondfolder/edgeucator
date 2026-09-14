import { describe, expect, test, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';

let mockKeyringStatus = 'locked';

vi.mock('$app/paths', () => ({
	resolve: (id: string, params?: Record<string, string>) =>
		params ? id.replace(/\[(\w+)\]/g, (_, key) => params[key]) : id
}));

vi.mock('$lib/crypto/session.svelte', () => ({
	currentKeyring: () => ({ status: mockKeyringStatus, reason: null }),
	initialiseKeyring: vi.fn().mockResolvedValue(undefined),
	resetKeyring: vi.fn(),
	unlockWithPassword: vi.fn()
}));

const { default: EncryptionGate } = await import('./EncryptionGate.svelte');

const user = { id: 'usr-1', email: 'ada@example.com' };

describe('EncryptionGate', () => {
	test('shows locked callout when keyring is locked and user has partners', () => {
		mockKeyringStatus = 'locked';
		render(EncryptionGate, { user, hasPartners: true, handledByPage: false });

		expect(screen.getByText('Your messages are locked on this device')).toBeInTheDocument();
	});

	test('does NOT show locked callout when keyring is locked but user has no partners', () => {
		mockKeyringStatus = 'locked';
		render(EncryptionGate, { user, hasPartners: false, handledByPage: false });

		expect(screen.queryByText('Your messages are locked on this device')).not.toBeInTheDocument();
	});

	test('does NOT show locked callout when handledByPage is true even if user has partners', () => {
		mockKeyringStatus = 'locked';
		render(EncryptionGate, { user, hasPartners: true, handledByPage: true });

		expect(screen.queryByText('Your messages are locked on this device')).not.toBeInTheDocument();
	});
});
