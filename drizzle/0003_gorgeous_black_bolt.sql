CREATE TABLE `account_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`action` text NOT NULL,
	`code_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_actions_user_action_unique` ON `account_actions` (`user_id`,`action`);--> statement-breakpoint
CREATE INDEX `account_actions_expiry_index` ON `account_actions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `monitoring_events` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`severity` text DEFAULT 'warning' NOT NULL,
	`route` text DEFAULT '' NOT NULL,
	`message` text NOT NULL,
	`actor_hash` text DEFAULT '' NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`notified_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `monitoring_events_category_created_index` ON `monitoring_events` (`category`,`created_at`);--> statement-breakpoint
CREATE INDEX `monitoring_events_severity_created_index` ON `monitoring_events` (`severity`,`created_at`);--> statement-breakpoint
ALTER TABLE `users` ADD `session_version` integer DEFAULT 0 NOT NULL;