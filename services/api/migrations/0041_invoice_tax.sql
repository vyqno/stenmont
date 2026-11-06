-- Optional tax label on an invoice: a rate in basis points and a short label (VAT, GST, ...). Display and export only.
ALTER TABLE `invoices` ADD `tax_rate_bps` integer;--> statement-breakpoint
ALTER TABLE `invoices` ADD `tax_label` text;
