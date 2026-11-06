ALTER TABLE `claims` ADD `show_invoice_number` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `claims` ADD `listed_at` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `funded_at` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `closed_at` text;
