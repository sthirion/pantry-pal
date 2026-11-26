CREATE TABLE `item_change` (
	`item_id` text NOT NULL,
	`household_id` text NOT NULL,
	`item_revision` integer NOT NULL,
	`mutation_id` text NOT NULL,
	`fields` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`item_id`, `item_revision`),
	FOREIGN KEY (`item_id`) REFERENCES `list_item`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `item_change_created_at_idx` ON `item_change` (`created_at`);--> statement-breakpoint
CREATE TABLE `item_mutation_receipt` (
	`household_id` text NOT NULL,
	`mutation_id` text NOT NULL,
	`item_id` text NOT NULL,
	`base_item_revision` integer NOT NULL,
	`changes` text NOT NULL,
	`applied_fields` text NOT NULL,
	`conflicts` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`household_id`, `mutation_id`),
	FOREIGN KEY (`item_id`) REFERENCES `list_item`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `item_mutation_receipt_item_id_idx` ON `item_mutation_receipt` (`item_id`);--> statement-breakpoint
ALTER TABLE `list_item` ADD `item_revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `list_item` ADD `pruned_through_item_revision` integer DEFAULT 0 NOT NULL;