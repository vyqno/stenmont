CREATE TABLE `claims` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`merchant_id` text NOT NULL,
	`status` text NOT NULL,
	`discount_bps` integer NOT NULL,
	`reserve_bps` integer NOT NULL,
	`face` text NOT NULL,
	`price` text NOT NULL,
	`reserve` text NOT NULL,
	`due_date` integer NOT NULL,
	`deadline` integer NOT NULL,
	`terms_challenge` text NOT NULL,
	`hook_challenge` text NOT NULL,
	`expires_at` integer NOT NULL,
	`investor` text,
	`list_tx_hash` text,
	`fund_tx_hash` text,
	`close_tx_hash` text,
	`lease_until` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `claims_invoice_idx` ON `claims` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `claims_status_idx` ON `claims` (`status`);--> statement-breakpoint
CREATE TABLE `investor_enrollments` (
	`address` text PRIMARY KEY NOT NULL,
	`action` text NOT NULL,
	`nullifier` text NOT NULL,
	`verified_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `investor_enrollments_action_nullifier` ON `investor_enrollments` (`action`,`nullifier`);