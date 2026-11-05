CREATE TABLE `chain_cursor` (
	`name` text PRIMARY KEY NOT NULL,
	`last_block` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`number` text NOT NULL,
	`status` text NOT NULL,
	`amount` text NOT NULL,
	`amount_paid` text DEFAULT '0' NOT NULL,
	`amount_refunded` text DEFAULT '0' NOT NULL,
	`currency` text DEFAULT 'USDT' NOT NULL,
	`customer_email` text,
	`due_date` text,
	`meta_hash` text NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`create_tx_hash` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_merchant_number_uq` ON `invoices` (`merchant_id`,`number`);--> statement-breakpoint
CREATE INDEX `invoices_merchant_created_idx` ON `invoices` (`merchant_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `payment_links` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`slug` text NOT NULL,
	`amount` text,
	`reusable` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_links_slug_uq` ON `payment_links` (`slug`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`payer` text NOT NULL,
	`value` text NOT NULL,
	`tx_hash` text NOT NULL,
	`log_index` integer NOT NULL,
	`block_number` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_tx_log_uq` ON `payments` (`tx_hash`,`log_index`);--> statement-breakpoint
CREATE INDEX `payments_invoice_idx` ON `payments` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`endpoint_id` text NOT NULL,
	`merchant_id` text NOT NULL,
	`event_id` text NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`response_status` integer,
	`last_error` text,
	`created_at` text NOT NULL,
	`delivered_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_deliveries_endpoint_event_uq` ON `webhook_deliveries` (`endpoint_id`,`event_id`);--> statement-breakpoint
CREATE TABLE `webhook_endpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`url` text NOT NULL,
	`secret` text NOT NULL,
	`events` text DEFAULT '[]' NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `webhook_endpoints_merchant_idx` ON `webhook_endpoints` (`merchant_id`);--> statement-breakpoint
ALTER TABLE `merchants` ADD `address` text;