CREATE TABLE `assignment_sections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`assignment_id` integer NOT NULL,
	`urutan` integer NOT NULL,
	`subject` text NOT NULL,
	`jumlah_soal` integer NOT NULL,
	`filters_json` text,
	`manual_question_ids_json` text,
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `assignment_sections_assignment_idx` ON `assignment_sections` (`assignment_id`);--> statement-breakpoint
CREATE TABLE `assignments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`judul` text NOT NULL,
	`selection_mode` text DEFAULT 'random' NOT NULL,
	`timing_mode` text DEFAULT 'proporsional' NOT NULL,
	`duration_seconds` integer,
	`allow_repeat` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `attempt_answers` (
	`attempt_id` integer NOT NULL,
	`question_id` text NOT NULL,
	`response_json` text NOT NULL,
	`is_correct` integer,
	`points` real,
	`points_max` real,
	`answered_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`attempt_id`, `question_id`),
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `attempt_answers_question_idx` ON `attempt_answers` (`question_id`);--> statement-breakpoint
CREATE TABLE `attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`assignment_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`status` text DEFAULT 'belum_mulai' NOT NULL,
	`question_order_json` text NOT NULL,
	`option_orders_json` text NOT NULL,
	`flagged_json` text,
	`started_at` integer,
	`deadline_at` integer,
	`submitted_at` integer,
	`elapsed_seconds` integer,
	`score_points` real,
	`score_max` real,
	`score_percent` real,
	`score_breakdown_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attempts_assignment_user_idx` ON `attempts` (`assignment_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `attempts_user_idx` ON `attempts` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`subject` text NOT NULL,
	`content_domain` text NOT NULL,
	`competency` text NOT NULL,
	`difficulty` text NOT NULL,
	`type` text NOT NULL,
	`stimulus_id` text,
	`stem_md` text NOT NULL,
	`figure_json` text,
	`options_json` text NOT NULL,
	`answer_json` text NOT NULL,
	`explanation_md` text NOT NULL,
	`explanation_figure_json` text,
	`fingerprint` text NOT NULL,
	`batch` text NOT NULL,
	`aktif` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`stimulus_id`) REFERENCES `stimuli`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `questions_pool_idx` ON `questions` (`subject`,`aktif`,`content_domain`,`competency`,`difficulty`,`type`);--> statement-breakpoint
CREATE INDEX `questions_fingerprint_idx` ON `questions` (`fingerprint`);--> statement-breakpoint
CREATE TABLE `stimuli` (
	`id` text PRIMARY KEY NOT NULL,
	`subject` text NOT NULL,
	`judul` text NOT NULL,
	`jenis_teks` text NOT NULL,
	`body_md` text NOT NULL,
	`figure_json` text,
	`sumber` text,
	`batch` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_question_history` (
	`user_id` integer NOT NULL,
	`question_id` text NOT NULL,
	`attempt_id` integer,
	`seen_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`user_id`, `question_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nama` text NOT NULL,
	`avatar_warna` text DEFAULT 'biru' NOT NULL,
	`aktif` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
