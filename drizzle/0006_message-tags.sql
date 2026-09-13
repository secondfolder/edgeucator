CREATE TABLE `message_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`partnership_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`partnership_id`) REFERENCES `partnerships`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `message_tags_partnership_name_unq` ON `message_tags` (`partnership_id`,`name`);--> statement-breakpoint
CREATE INDEX `message_tags_partnership_idx` ON `message_tags` (`partnership_id`);--> statement-breakpoint
CREATE TABLE `message_thread_tags` (
	`thread_id` text NOT NULL,
	`tag_id` text NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `message_threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `message_tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `message_thread_tags_thread_tag_unq` ON `message_thread_tags` (`thread_id`,`tag_id`);--> statement-breakpoint
CREATE INDEX `message_thread_tags_tag_idx` ON `message_thread_tags` (`tag_id`);