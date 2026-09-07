CREATE TABLE `partnerships` (
	`id` text PRIMARY KEY NOT NULL,
	`inviter_id` text NOT NULL,
	`invitee_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`inviter_name` text NOT NULL,
	`invitee_name` text NOT NULL,
	`relationship_label` text,
	`control` text NOT NULL,
	`invite_token` text,
	`invite_expires_at` integer,
	`accepted_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`inviter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invitee_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `partnerships_invite_token_unique` ON `partnerships` (`invite_token`);--> statement-breakpoint
CREATE INDEX `partnerships_inviter_id_idx` ON `partnerships` (`inviter_id`);--> statement-breakpoint
CREATE INDEX `partnerships_invitee_id_idx` ON `partnerships` (`invitee_id`);