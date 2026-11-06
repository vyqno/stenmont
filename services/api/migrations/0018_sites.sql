CREATE TABLE `sites` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`url` text NOT NULL,
	`host` text NOT NULL,
	`platform` text,
	`token` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sites_merchant_host_uq` ON `sites` (`merchant_id`,`host`);--> statement-breakpoint
CREATE TABLE `site_checks` (
	`site_id` text NOT NULL,
	`kind` text NOT NULL,
	`ok` integer NOT NULL,
	`detail` text NOT NULL,
	`checked_at` text NOT NULL,
	PRIMARY KEY(`site_id`, `kind`)
);
--> statement-breakpoint
CREATE TABLE `payment_switch` (
	`merchant_id` text PRIMARY KEY NOT NULL,
	`paused` integer DEFAULT 0 NOT NULL,
	`mode` text DEFAULT 'test' NOT NULL,
	`updated_at` text NOT NULL
);
