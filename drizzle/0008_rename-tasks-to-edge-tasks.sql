ALTER TABLE `tasks` RENAME TO `edge_tasks`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_edge_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`guide_id` text NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`instructions` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`guide_id`) REFERENCES `guides`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_edge_tasks`("id", "guide_id", "order", "instructions", "created_at", "updated_at") SELECT "id", "guide_id", "order", "instructions", "created_at", "updated_at" FROM `edge_tasks`;--> statement-breakpoint
DROP TABLE `edge_tasks`;--> statement-breakpoint
ALTER TABLE `__new_edge_tasks` RENAME TO `edge_tasks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `edge_tasks_guide_id_order_idx` ON `edge_tasks` (`guide_id`,`order`);