CREATE TABLE `attempt_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`attempt_id` integer NOT NULL,
	`run_no` integer NOT NULL,
	`started_at` integer,
	`submitted_at` integer,
	`elapsed_seconds` integer,
	`score_points` real,
	`score_max` real,
	`score_percent` real,
	`score_breakdown_json` text,
	`answers_json` text NOT NULL,
	`archived_by` integer,
	`archived_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `attempt_runs_attempt_idx` ON `attempt_runs` (`attempt_id`,`run_no`);--> statement-breakpoint
CREATE TABLE `question_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`question_id` text NOT NULL,
	`user_id` integer,
	`attempt_id` integer,
	`pesan` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `question_reports_open_idx` ON `question_reports` (`resolved_at`,`question_id`);--> statement-breakpoint
ALTER TABLE `assignments` ADD `due_at` integer;--> statement-breakpoint
ALTER TABLE `attempts` ADD `item_snapshot_json` text;--> statement-breakpoint
ALTER TABLE `questions` ADD `retired_by_admin` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `last_seen_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `temp_password_expires_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_lower_idx` ON `users` (lower("username"));