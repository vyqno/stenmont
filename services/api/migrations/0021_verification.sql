-- Trust tiers. A record is one decision about one business by one method; the tier is computed from records (and from
-- facts held elsewhere: a verified domain, a World enrolment). No documents or personal details are ever stored here.
CREATE TABLE `verification_records` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`tier` integer NOT NULL,
	`method` text NOT NULL,
	`provider` text,
	`reference` text,
	`decision` text NOT NULL,
	`decided_at` text NOT NULL,
	`expires_at` text
);
--> statement-breakpoint
CREATE INDEX `verification_records_merchant` ON `verification_records` (`merchant_id`,`method`);--> statement-breakpoint
CREATE UNIQUE INDEX `verification_records_provider_ref` ON `verification_records` (`provider`,`reference`);--> statement-breakpoint
CREATE TABLE `verification_limits` (
	`tier` integer PRIMARY KEY NOT NULL,
	`per_invoice` text NOT NULL,
	`daily_volume` text NOT NULL,
	`financing_cap` text NOT NULL,
	`investor` integer NOT NULL DEFAULT 0,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `kyc_webhook_events` (
	`provider` text NOT NULL,
	`event_id` text NOT NULL,
	`received_at` text NOT NULL,
	PRIMARY KEY(`provider`, `event_id`)
);
--> statement-breakpoint
CREATE TABLE `wallet_logins` (
	`address` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `wallet_logins_merchant` ON `wallet_logins` (`merchant_id`);--> statement-breakpoint
CREATE TABLE `siwe_nonces` (
	`nonce` text PRIMARY KEY NOT NULL,
	`merchant_id` text,
	`expires_at` text NOT NULL,
	`used_at` text
);
--> statement-breakpoint
CREATE TABLE `tier_badges` (
	`merchant_id` text PRIMARY KEY NOT NULL,
	`published_tier` integer NOT NULL,
	`tx_hash` text,
	`published_at` text NOT NULL
);
