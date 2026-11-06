CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`amount` text NOT NULL,
	`period_seconds` integer NOT NULL,
	`max_charges` integer NOT NULL,
	`start_at` integer NOT NULL,
	`customer_email` text,
	`payer` text,
	`status` text NOT NULL,
	`charges` integer DEFAULT 0 NOT NULL,
	`next_charge_at` integer NOT NULL,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`retry_at` integer,
	`subscribe_tx` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
