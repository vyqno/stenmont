CREATE TABLE `shopify_oauth_pending` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`shop` text NOT NULL,
	`state_hash` text NOT NULL,
	`include_customers` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shopify_oauth_pending_state_uq` ON `shopify_oauth_pending` (`state_hash`);
--> statement-breakpoint
CREATE INDEX `shopify_oauth_pending_expiry_idx` ON `shopify_oauth_pending` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `shopify_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`shop` text NOT NULL,
	`sealed_token` text NOT NULL,
	`include_customers` integer DEFAULT 0 NOT NULL,
	`currency` text,
	`report` text,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shopify_connections_merchant_shop_uq` ON `shopify_connections` (`merchant_id`,`shop`);
--> statement-breakpoint
CREATE INDEX `shopify_connections_expiry_idx` ON `shopify_connections` (`expires_at`);
