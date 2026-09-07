import { svelteTesting } from '@testing-library/svelte/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

const host: string | undefined = process.env.HOST;
const port: number = Number(process.env.PORT) || 58769;

export default defineConfig({
	plugins: [sveltekit()],

	test: {
		projects: [
			{
				extends: './vite.config.ts',
				plugins: [svelteTesting()],

				test: {
					name: 'client',
					environment: 'jsdom',
					clearMocks: true,
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**'],
					setupFiles: ['./vitest-setup-client.ts']
				}
			},
			{
				extends: './vite.config.ts',

				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	},

	server: {
		host: host,
        port: port,
		// Overridable so the Playwright suite can run against localhost: with the
		// tunnel host baked in, a page served from 127.0.0.1 asks the tunnel for
		// its modules and never hydrates.
		origin: process.env.VITE_DEV_ORIGIN
	}
});
