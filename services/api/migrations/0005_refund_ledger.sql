CREATE TABLE `refunds` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`to_address` text NOT NULL,
	`value` text NOT NULL,
	`tx_hash` text NOT NULL,
	`log_index` integer NOT NULL,
	`block_number` integer NOT NULL,
	`reason` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `refunds_tx_log_uq` ON `refunds` (`tx_hash`,`log_index`);--> statement-breakpoint
CREATE INDEX `refunds_invoice_idx` ON `refunds` (`invoice_id`);