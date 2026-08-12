CREATE TABLE `email_registrations` (
	`email` text PRIMARY KEY NOT NULL,
	`company_name` text NOT NULL,
	`password_hash` text NOT NULL,
	`code_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_sent_at` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `users` ADD `auth_provider` text DEFAULT 'google' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `password_hash` text;--> statement-breakpoint
ALTER TABLE `users` ADD `email_verified_at` text;