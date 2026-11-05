CREATE TABLE `gas_tanks` (
	`merchant_id` text PRIMARY KEY NOT NULL,
	`wbt_balance` text DEFAULT '0' NOT NULL,
	`daily_cap_wbt` text NOT NULL,
	`spent_today_wbt` text DEFAULT '0' NOT NULL,
	`spent_day` text NOT NULL,
	`per_payer_daily_cap_usdt` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `payer_usage` (
	`merchant_id` text NOT NULL,
	`payer` text NOT NULL,
	`day` text NOT NULL,
	`usdt` text DEFAULT '0' NOT NULL,
	PRIMARY KEY(`merchant_id`, `payer`, `day`)
);
--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text NOT NULL,
	`bucket` integer NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`key`, `bucket`)
);
--> statement-breakpoint
CREATE TABLE `relayer_txs` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`invoice_id` text,
	`kind` text NOT NULL,
	`payer` text,
	`value` text,
	`tx_hash` text,
	`status` text NOT NULL,
	`error` text,
	`gas_used` text,
	`wbt_cost` text,
	`idempotency_key` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `relayer_txs_idem_uq` ON `relayer_txs` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `relayer_txs_merchant_idx` ON `relayer_txs` (`merchant_id`,`created_at`);