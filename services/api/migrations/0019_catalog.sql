CREATE TABLE `store_settings` (
	`merchant_id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `store_settings_slug_uq` ON `store_settings` (`slug`);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`handle` text NOT NULL,
	`title` text NOT NULL,
	`description_html` text DEFAULT '' NOT NULL,
	`vendor` text DEFAULT '' NOT NULL,
	`product_type` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`external_source` text,
	`external_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_merchant_handle_uq` ON `products` (`merchant_id`,`handle`);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_external_uq` ON `products` (`merchant_id`,`external_source`,`external_id`);
--> statement-breakpoint
CREATE TABLE `variants` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`product_id` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`sku` text DEFAULT '' NOT NULL,
	`price` text NOT NULL,
	`inventory` integer DEFAULT 0 NOT NULL,
	`track_inventory` integer DEFAULT 1 NOT NULL,
	`options` text DEFAULT '{}' NOT NULL,
	`position` integer DEFAULT 1 NOT NULL,
	`external_source` text,
	`external_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `variants_product_idx` ON `variants` (`product_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `variants_external_uq` ON `variants` (`merchant_id`,`external_source`,`external_id`);
--> statement-breakpoint
CREATE TABLE `product_images` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`product_id` text NOT NULL,
	`url` text NOT NULL,
	`alt` text DEFAULT '' NOT NULL,
	`position` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_images_uq` ON `product_images` (`product_id`,`url`);
--> statement-breakpoint
CREATE TABLE `collections` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`handle` text NOT NULL,
	`title` text NOT NULL,
	`external_source` text,
	`external_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collections_merchant_handle_uq` ON `collections` (`merchant_id`,`handle`);
--> statement-breakpoint
CREATE TABLE `product_collections` (
	`product_id` text NOT NULL,
	`collection_id` text NOT NULL,
	PRIMARY KEY(`product_id`, `collection_id`)
);
--> statement-breakpoint
CREATE TABLE `imported_customers` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`external_source` text NOT NULL,
	`external_id` text NOT NULL,
	`email` text NOT NULL,
	`first_name` text DEFAULT '' NOT NULL,
	`last_name` text DEFAULT '' NOT NULL,
	`country` text DEFAULT '' NOT NULL,
	`accepts_marketing` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `imported_customers_external_uq` ON `imported_customers` (`merchant_id`,`external_source`,`external_id`);
--> statement-breakpoint
CREATE TABLE `imported_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`external_source` text NOT NULL,
	`external_id` text NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`financial_status` text DEFAULT '' NOT NULL,
	`fulfillment_status` text DEFAULT '' NOT NULL,
	`currency` text DEFAULT '' NOT NULL,
	`total` text DEFAULT '0' NOT NULL,
	`line_count` integer DEFAULT 0 NOT NULL,
	`ordered_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `imported_orders_external_uq` ON `imported_orders` (`merchant_id`,`external_source`,`external_id`);
--> statement-breakpoint
CREATE TABLE `store_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`invoice_id` text,
	`status` text NOT NULL,
	`lines` text NOT NULL,
	`total` text NOT NULL,
	`reserved_until` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `store_orders_merchant_idx` ON `store_orders` (`merchant_id`,`status`);
