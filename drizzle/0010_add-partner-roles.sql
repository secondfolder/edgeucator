ALTER TABLE `partnerships` ADD `inviter_role` text;--> statement-breakpoint
ALTER TABLE `partnerships` ADD `invitee_role` text;--> statement-breakpoint
ALTER TABLE `partnerships` DROP COLUMN `relationship_label`;