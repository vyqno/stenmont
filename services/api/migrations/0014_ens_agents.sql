CREATE TABLE `ens_agents` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`label` text NOT NULL,
	`name` text NOT NULL,
	`agent_address` text NOT NULL,
	`resolver` text NOT NULL,
	`scopes` text DEFAULT '[]' NOT NULL,
	`daily_limit` text NOT NULL,
	`per_tx_limit` text NOT NULL,
	`expires_at` text NOT NULL,
	`status` text NOT NULL,
	`tx_hashes` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ens_agents_merchant_label_uq` ON `ens_agents` (`merchant_id`,`label`);