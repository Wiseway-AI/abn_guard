ALTER TABLE `users` ADD `clerk_user_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `users_clerk_user_unique` ON `users` (`clerk_user_id`);