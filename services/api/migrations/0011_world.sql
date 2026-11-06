CREATE TABLE `approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`operation` text NOT NULL,
	`params_hash` text NOT NULL,
	`nonce` text NOT NULL,
	`status` text NOT NULL,
	`world_sub` text,
	`auth_time` integer,
	`deny_reason` text,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `approvals_lookup` ON `approvals` (`merchant_id`,`operation`,`created_at`);--> statement-breakpoint
CREATE TABLE `world_enrollments` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`action` text NOT NULL,
	`nullifier` text NOT NULL,
	`verified_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `world_enrollments_action_nullifier` ON `world_enrollments` (`action`,`nullifier`);--> statement-breakpoint
CREATE UNIQUE INDEX `world_enrollments_merchant_action` ON `world_enrollments` (`merchant_id`,`action`);--> statement-breakpoint
ALTER TABLE `invoices` ADD `buyer_merchant_id` text;