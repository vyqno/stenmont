CREATE TABLE `refund_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`to_address` text NOT NULL,
	`value` text NOT NULL,
	`salt` text NOT NULL,
	`valid_before` integer NOT NULL,
	`challenge` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`tx_hash` text,
	`created_at` text NOT NULL
);
