CREATE TABLE `change_counter` (
	`id` integer PRIMARY KEY NOT NULL,
	`value` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `household` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `household_member` (
	`household_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`household_id`, `user_id`),
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `household_member_user_id_unique` ON `household_member` (`user_id`);--> statement-breakpoint
CREATE TABLE `item_suggestion` (
	`household_id` text NOT NULL,
	`name_key` text NOT NULL,
	`name` text NOT NULL,
	`use_count` integer NOT NULL,
	`last_used_at` integer NOT NULL,
	PRIMARY KEY(`household_id`, `name_key`)
);
--> statement-breakpoint
CREATE INDEX `item_suggestion_household_last_used_idx` ON `item_suggestion` (`household_id`,"last_used_at" desc);--> statement-breakpoint
CREATE TABLE `list_item` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`list_id` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`crossed_off_at` integer,
	`version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`list_id`) REFERENCES `shopping_list`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `list_item_list_name_key_live_unique` ON `list_item` (`list_id`,`name_key`) WHERE "list_item"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `list_item_household_version_idx` ON `list_item` (`household_id`,`version`);--> statement-breakpoint
CREATE TABLE `shopping_list` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shopping_list_household_name_key_live_unique` ON `shopping_list` (`household_id`,`name_key`) WHERE "shopping_list"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `shopping_list_household_version_idx` ON `shopping_list` (`household_id`,`version`);--> statement-breakpoint
CREATE TABLE `sync_state` (
	`household_id` text PRIMARY KEY NOT NULL,
	`purged_through_version` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);