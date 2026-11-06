-- Optional tax label on an invoice: a rate in basis points and a short label (VAT, GST, ...). Display and export only.
ALTER TABLE `invoices` ADD `tax_rate_bps` integer;--> statement-breakpoint
ALTER TABLE `invoices` ADD `tax_label` text;
--> statement-breakpoint
CREATE TABLE books_closes (
  merchant_id text NOT NULL,
  period text NOT NULL,
  closed_at text NOT NULL,
  bundle text NOT NULL,
  PRIMARY KEY (merchant_id, period)
);
--> statement-breakpoint
CREATE TABLE books_observed_events (
  merchant_id text NOT NULL,
  source_id text NOT NULL,
  observed_at text NOT NULL,
  PRIMARY KEY (merchant_id, source_id)
);
--> statement-breakpoint
CREATE TABLE books_anchors (
  merchant_id text NOT NULL,
  period text NOT NULL,
  tx_hash text NOT NULL,
  confirmed_at text NOT NULL,
  PRIMARY KEY (merchant_id, period)
);
