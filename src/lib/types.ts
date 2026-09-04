/**
 * Shared types that BOTH server code and Svelte components need.
 *
 * Deliberately not under `$lib/server/` (components may not import from there),
 * and deliberately alias-free so the Drizzle schema can import it by relative
 * path — drizzle-kit and the seed script bundle the schema outside Vite, where
 * `$lib` does not resolve.
 */

export type TaskDisplayText = {
	/** Show this text once the running count reaches this value. */
	showFrom: number;
	text: string;
};

export type TaskInstructions = {
	type: 'count';
	version: 1;
	/** Total number of `action`s required to complete the task. */
	required: number;
	action: 'edge';
	displayText: TaskDisplayText[];
};

/** The subset of a `tasks` row that Task.svelte consumes. */
export type TaskView = {
	id: string;
	order: number;
	instructions: TaskInstructions;
};

/** The subset of a `guides` row that GuidesList.svelte / Guide.svelte consume. */
export type GuideView = {
	id: string;
	title: string;
};
