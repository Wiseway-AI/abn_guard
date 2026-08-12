CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`picture` text DEFAULT '' NOT NULL,
	`stripe_customer_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`name` text NOT NULL,
	`plan` text DEFAULT 'free' NOT NULL,
	`subscription_status` text DEFAULT 'free' NOT NULL,
	`stripe_subscription_id` text,
	`stripe_price_id` text,
	`current_period_end` integer,
	`state_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_owner_unique` ON `workspaces` (`owner_user_id`);--> statement-breakpoint
CREATE INDEX `workspaces_subscription_index` ON `workspaces` (`stripe_subscription_id`);