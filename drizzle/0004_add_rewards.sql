CREATE TABLE `partnership_reward_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`partnership_id` text NOT NULL,
	`reward_id` text NOT NULL,
	`claimed_by_user_id` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`reward_title` text NOT NULL,
	`reward_description` text,
	`reward_cost` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`partnership_id`) REFERENCES `partnerships`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reward_id`) REFERENCES `partnership_rewards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`claimed_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `partnership_reward_claims_partnership_claimed_idx` ON `partnership_reward_claims` (`partnership_id`,`claimed_by_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `partnership_reward_claims_reward_idx` ON `partnership_reward_claims` (`reward_id`);--> statement-breakpoint
CREATE TABLE `partnership_reward_credits` (
	`id` text PRIMARY KEY NOT NULL,
	`partnership_id` text NOT NULL,
	`user_id` text NOT NULL,
	`credits` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`partnership_id`) REFERENCES `partnerships`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `partnership_reward_credits_partnership_user_unq` ON `partnership_reward_credits` (`partnership_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `partnership_reward_credits_user_partnership_idx` ON `partnership_reward_credits` (`user_id`,`partnership_id`);--> statement-breakpoint
CREATE TABLE `partnership_rewards` (
	`id` text PRIMARY KEY NOT NULL,
	`partnership_id` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`cost` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`partnership_id`) REFERENCES `partnerships`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `partnership_rewards_partnership_active_idx` ON `partnership_rewards` (`partnership_id`,`active`);--> statement-breakpoint
CREATE INDEX `partnership_rewards_partnership_created_idx` ON `partnership_rewards` (`partnership_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `partnership_rewards_creator_idx` ON `partnership_rewards` (`created_by_user_id`);--> statement-breakpoint
CREATE TABLE `self_reward_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`reward_id` text NOT NULL,
	`reward_title` text NOT NULL,
	`reward_description` text,
	`reward_cost` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reward_id`) REFERENCES `self_rewards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `self_reward_claims_owner_created_idx` ON `self_reward_claims` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `self_reward_claims_reward_idx` ON `self_reward_claims` (`reward_id`);--> statement-breakpoint
CREATE TABLE `self_reward_credits` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`credits` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `self_reward_credits_owner_id_unique` ON `self_reward_credits` (`owner_id`);--> statement-breakpoint
CREATE INDEX `self_reward_credits_owner_idx` ON `self_reward_credits` (`owner_id`);--> statement-breakpoint
CREATE TABLE `self_rewards` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`cost` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `self_rewards_owner_active_idx` ON `self_rewards` (`owner_id`,`active`);--> statement-breakpoint
CREATE INDEX `self_rewards_owner_created_idx` ON `self_rewards` (`owner_id`,`created_at`);
