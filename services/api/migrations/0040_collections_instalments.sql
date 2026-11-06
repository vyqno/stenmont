ALTER TABLE `subscriptions` ADD `kind` text DEFAULT 'subscription' NOT NULL;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `invoice_id` text;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `payer_business_name` text;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `segments` text;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `total` text;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `at_risk_reason` text;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `at_risk_at` text;--> statement-breakpoint
CREATE INDEX `subscriptions_invoice` ON `subscriptions` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `collections_policy` (
	`merchant_id` text PRIMARY KEY NOT NULL,
	`max_discount_bps` integer DEFAULT 0 NOT NULL,
	`max_instalments` integer DEFAULT 0 NOT NULL,
	`max_extension_days` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);--> statement-breakpoint
CREATE TABLE `collections_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`to_email` text,
	`subject` text NOT NULL,
	`message` text NOT NULL,
	`terms` text DEFAULT '{}' NOT NULL,
	`link` text,
	`exception` integer DEFAULT 0 NOT NULL,
	`subscription_id` text,
	`created_at` text NOT NULL,
	`decided_at` text
);--> statement-breakpoint
CREATE INDEX `collections_actions_merchant` ON `collections_actions` (`merchant_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `collections_actions_invoice` ON `collections_actions` (`invoice_id`,`kind`,`status`);
