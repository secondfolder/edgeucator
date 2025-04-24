// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces

import type PocketBase from 'pocketbase';
declare global {
	namespace App {
		// interface Error {}
		// interface PageState {}
		// interface Platform {}
		interface Locals {
			pb: PocketBase;
			user: PocketBase['authStore']['record'];
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
