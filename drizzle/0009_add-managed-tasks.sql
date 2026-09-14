CREATE TABLE `partnership_task_completions` (
	`id` text PRIMARY KEY NOT NULL,
	`partnership_id` text NOT NULL,
	`task_id` text NOT NULL,
	`completed_by_user_id` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`task_title` text NOT NULL,
	`task_description` text,
	`credits_awarded` integer NOT NULL,
	`completion_message` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`partnership_id`) REFERENCES `partnerships`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `partnership_tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`completed_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `partnership_task_completions_partnership_completed_idx` ON `partnership_task_completions` (`partnership_id`,`completed_by_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `partnership_task_completions_task_idx` ON `partnership_task_completions` (`task_id`);--> statement-breakpoint
CREATE TABLE `partnership_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`partnership_id` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`timezone_owner_user_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`active` integer DEFAULT true NOT NULL,
	`credits_awarded` integer DEFAULT 0 NOT NULL,
	`completion_messages` text NOT NULL,
	`schedule` text NOT NULL,
	`last_completed_at` integer,
	`completed_count` integer DEFAULT 0 NOT NULL,
	`next_eligible_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`partnership_id`) REFERENCES `partnerships`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`timezone_owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `partnership_tasks_partnership_active_idx` ON `partnership_tasks` (`partnership_id`,`active`);--> statement-breakpoint
CREATE INDEX `partnership_tasks_partnership_next_eligible_idx` ON `partnership_tasks` (`partnership_id`,`next_eligible_at`);--> statement-breakpoint
CREATE INDEX `partnership_tasks_creator_idx` ON `partnership_tasks` (`created_by_user_id`);--> statement-breakpoint
CREATE INDEX `partnership_tasks_timezone_owner_idx` ON `partnership_tasks` (`timezone_owner_user_id`);--> statement-breakpoint
CREATE TABLE `self_task_completions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`task_id` text NOT NULL,
	`task_title` text NOT NULL,
	`task_description` text,
	`credits_awarded` integer NOT NULL,
	`completion_message` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `self_tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `self_task_completions_owner_created_idx` ON `self_task_completions` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `self_task_completions_task_idx` ON `self_task_completions` (`task_id`);--> statement-breakpoint
CREATE TABLE `self_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`active` integer DEFAULT true NOT NULL,
	`credits_awarded` integer DEFAULT 0 NOT NULL,
	`completion_messages` text NOT NULL,
	`schedule` text NOT NULL,
	`timezone_owner_user_id` text NOT NULL,
	`last_completed_at` integer,
	`completed_count` integer DEFAULT 0 NOT NULL,
	`next_eligible_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`timezone_owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `self_tasks_owner_active_idx` ON `self_tasks` (`owner_id`,`active`);--> statement-breakpoint
CREATE INDEX `self_tasks_owner_next_eligible_idx` ON `self_tasks` (`owner_id`,`next_eligible_at`);--> statement-breakpoint
CREATE INDEX `self_tasks_timezone_owner_idx` ON `self_tasks` (`timezone_owner_user_id`);