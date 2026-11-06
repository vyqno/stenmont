CREATE TABLE `ens_directory` (
	`merchant_id` text PRIMARY KEY NOT NULL,
	`pay_url` text,
	`x402_url` text,
	`refund` text,
	`published` text DEFAULT '{}' NOT NULL,
	`tx_hash` text,
	`published_at` text,
	`updated_at` text NOT NULL
);
