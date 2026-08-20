CREATE TABLE `contact_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`company_name` text NOT NULL,
	`email` text NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `contact_requests_status_created_index` ON `contact_requests` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`workspace_id` text,
	`email` text DEFAULT '' NOT NULL,
	`category` text NOT NULL,
	`message` text NOT NULL,
	`page_url` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `feedback_status_created_index` ON `feedback` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `feedback_actor_index` ON `feedback` (`actor_id`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`scope` text NOT NULL,
	`actor_key` text NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rate_limits_window_unique` ON `rate_limits` (`scope`,`actor_key`,`window_start`);--> statement-breakpoint
CREATE INDEX `rate_limits_window_index` ON `rate_limits` (`window_start`);--> statement-breakpoint
CREATE TABLE `stripe_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`event_created` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'processing' NOT NULL,
	`error` text,
	`created_at` text NOT NULL,
	`processed_at` text
);
--> statement-breakpoint
CREATE INDEX `stripe_events_status_index` ON `stripe_events` (`status`);--> statement-breakpoint
ALTER TABLE `workspaces` ADD `stripe_event_created` integer DEFAULT 0 NOT NULL;