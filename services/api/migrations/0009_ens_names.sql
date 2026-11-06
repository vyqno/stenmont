CREATE TABLE `ens_names` (
	`merchant_id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`name` text NOT NULL,
	`resolver` text NOT NULL,
	`agent_registry` text NOT NULL,
	`payout_locked` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`tx_hashes` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ens_names_label_uq` ON `ens_names` (`label`);