CREATE TABLE `workspace_data` (
	`workspace_id` text NOT NULL,
	`namespace` text NOT NULL,
	`item_id` text NOT NULL,
	`data_json` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `namespace`, `item_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workspace_data_workspace_namespace_index` ON `workspace_data` (`workspace_id`,`namespace`);