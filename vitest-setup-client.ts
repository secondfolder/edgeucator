import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

globalThis.litIssuedWarnings ??= new Set();
globalThis.litIssuedWarnings.add('dev-mode');
globalThis.litIssuedWarnings.add(
	'Lit is in dev mode. Not recommended for production! See https://lit.dev/msg/dev-mode for more information.'
);

// required for svelte5 + jsdom as jsdom does not support matchMedia
Object.defineProperty(window, 'matchMedia', {
	writable: true,
	enumerable: true,
	value: vi.fn().mockImplementation((query) => ({
		matches: false,
		media: query,
		onchange: null,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		dispatchEvent: vi.fn()
	}))
});

// add more mocks here if you need them
