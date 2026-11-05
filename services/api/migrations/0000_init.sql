CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`prefix` text NOT NULL,
	`hash` text NOT NULL,
	`scopes` text NOT NULL,
	`created_at` text NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE INDEX `api_keys_prefix_idx` ON `api_keys` (`prefix`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`merchant_id` text,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`key` text NOT NULL,
	`merchant_id` text NOT NULL,
	`response` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`key`, `merchant_id`)
);
--> statement-breakpoint
CREATE TABLE `merchants` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`ens_name` text,
	`payout_address` text,
	`created_at` text NOT NULL
);
