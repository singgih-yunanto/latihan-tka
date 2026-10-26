import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  real,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

/**
 * Database schema.
 *
 * Column names are Indonesian because the running app and its admin panel are
 * Indonesian; renaming them would require a migration for no functional gain.
 *
 * On timing: only the attempt as a whole is recorded (startedAt / submittedAt /
 * elapsedSeconds). There is no per-item or per-subject time column -- the
 * budget covers the entire assignment.
 */

const now = sql`(unixepoch())`;

/**
 * Every account, whatever its role.
 *
 * `username` and `passwordHash` are nullable on purpose: a row with neither is
 * an account an admin has created but not yet issued credentials for. Presence
 * and uniqueness are enforced in the application layer, which also keeps SQLite
 * from having to rebuild this table during migration.
 */
export const users = sqliteTable(
  'users',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    nama: text('nama').notNull(),
    /** admin | parent | student */
    role: text('role').notNull().default('student'),
    username: text('username'),
    passwordHash: text('password_hash'),
    mustChangePassword: integer('must_change_password', { mode: 'boolean' })
      .notNull()
      .default(true),
    /**
     * When the one-time password an admin issued stops working. Set together
     * with mustChangePassword; cleared once the holder picks their own.
     */
    tempPasswordExpiresAt: integer('temp_password_expires_at'),
    avatarWarna: text('avatar_warna').notNull().default('biru'),
    aktif: integer('aktif', { mode: 'boolean' }).notNull().default(true),
    /** Left off the shared ranking board by an admin. Students only. */
    rankingHidden: integer('ranking_hidden', { mode: 'boolean' }).notNull().default(false),
    createdBy: integer('created_by'),
    lastLoginAt: integer('last_login_at'),
    createdAt: integer('created_at').notNull().default(now),
  },
  (table) => ({
    usernameIdx: uniqueIndex('users_username_idx').on(table.username),
    // Every lookup is case-insensitive, so uniqueness has to be as well.
    usernameLowerIdx: uniqueIndex('users_username_lower_idx').on(sql`lower(${table.username})`),
    roleIdx: index('users_role_idx').on(table.role, table.aktif),
  }),
);

/**
 * Links a parent account to the children it may see.
 *
 * A join table rather than a column on the student, so one parent can have many
 * children and both parents can each hold an account for the same child.
 */
export const parentChildren = sqliteTable(
  'parent_children',
  {
    parentId: integer('parent_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    studentId: integer('student_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull().default(now),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.parentId, table.studentId] }),
    studentIdx: index('parent_children_student_idx').on(table.studentId),
  }),
);

/**
 * Sign-in sessions.
 *
 * Kept in the database rather than a signed cookie so that deactivating an
 * account takes effect on the very next request, and so no signing secret has
 * to be configured. Only the SHA-256 of the cookie token is stored, so a copy
 * of the database does not hand over live sessions.
 */
export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull().default(now),
    expiresAt: integer('expires_at').notNull(),
    /** Refreshed at most hourly; a session idle for too long stops working. */
    lastSeenAt: integer('last_seen_at'),
  },
  (table) => ({
    userIdx: index('sessions_user_idx').on(table.userId),
  }),
);

export const stimuli = sqliteTable('stimuli', {
  id: text('id').primaryKey(),
  subject: text('subject').notNull(),
  judul: text('judul').notNull(),
  jenisTeks: text('jenis_teks').notNull(),
  bodyMd: text('body_md').notNull(),
  figureJson: text('figure_json'),
  sumber: text('sumber'),
  batch: text('batch').notNull(),
  createdAt: integer('created_at').notNull().default(now),
});

export const questions = sqliteTable(
  'questions',
  {
    id: text('id').primaryKey(),
    subject: text('subject').notNull(),
    contentDomain: text('content_domain').notNull(),
    competency: text('competency').notNull(),
    difficulty: text('difficulty').notNull(),
    type: text('type').notNull(),
    stimulusId: text('stimulus_id').references(() => stimuli.id, { onDelete: 'set null' }),
    stemMd: text('stem_md').notNull(),
    figureJson: text('figure_json'),
    optionsJson: text('options_json').notNull(),
    answerJson: text('answer_json').notNull(),
    explanationMd: text('explanation_md').notNull(),
    explanationFigureJson: text('explanation_figure_json'),
    fingerprint: text('fingerprint').notNull(),
    batch: text('batch').notNull(),
    /** Present in the bank files. Owned by bank:sync. */
    aktif: integer('aktif', { mode: 'boolean' }).notNull().default(true),
    /**
     * Withdrawn by an admin from the panel. Owned by the admin, never touched
     * by bank:sync, so a deploy cannot silently bring a bad item back.
     */
    retiredByAdmin: integer('retired_by_admin', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull().default(now),
  },
  (table) => ({
    poolIdx: index('questions_pool_idx').on(
      table.subject,
      table.aktif,
      table.contentDomain,
      table.competency,
      table.difficulty,
      table.type,
    ),
    fingerprintIdx: index('questions_fingerprint_idx').on(table.fingerprint),
  }),
);

export const assignments = sqliteTable('assignments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  judul: text('judul').notNull(),
  selectionMode: text('selection_mode').notNull().default('random'),
  timingMode: text('timing_mode').notNull().default('proporsional'),
  /** TOTAL time budget for the whole assignment, in seconds. NULL = untimed. */
  durationSeconds: integer('duration_seconds'),
  allowRepeat: integer('allow_repeat', { mode: 'boolean' }).notNull().default(false),
  /** Optional "finish by" date, epoch seconds. Informational: never locks work. */
  dueAt: integer('due_at'),
  /** Who created it, so a parent can only delete their own. */
  createdBy: integer('created_by'),
  createdAt: integer('created_at').notNull().default(now),
});

export const assignmentSections = sqliteTable(
  'assignment_sections',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    assignmentId: integer('assignment_id')
      .notNull()
      .references(() => assignments.id, { onDelete: 'cascade' }),
    urutan: integer('urutan').notNull(),
    subject: text('subject').notNull(),
    jumlahSoal: integer('jumlah_soal').notNull(),
    filtersJson: text('filters_json'),
    manualQuestionIdsJson: text('manual_question_ids_json'),
  },
  (table) => ({
    assignmentIdx: index('assignment_sections_assignment_idx').on(table.assignmentId),
  }),
);

export const attempts = sqliteTable(
  'attempts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    assignmentId: integer('assignment_id')
      .notNull()
      .references(() => assignments.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** belum_mulai (not started) | berjalan (in progress) | selesai (finished) */
    status: text('status').notNull().default('belum_mulai'),
    questionOrderJson: text('question_order_json').notNull(),
    optionOrdersJson: text('option_orders_json').notNull(),
    flaggedJson: text('flagged_json'),
    startedAt: integer('started_at'),
    deadlineAt: integer('deadline_at'),
    submittedAt: integer('submitted_at'),
    elapsedSeconds: integer('elapsed_seconds'),
    scorePoints: real('score_points'),
    scoreMax: real('score_max'),
    scorePercent: real('score_percent'),
    scoreBreakdownJson: text('score_breakdown_json'),
    /**
     * The type, options and answer key of every drawn item, frozen at draw
     * time. Grading and review read this rather than the live bank, so editing
     * a key in content/bank never contradicts a score already given.
     * NULL for attempts drawn before this column existed.
     */
    itemSnapshotJson: text('item_snapshot_json'),
    createdAt: integer('created_at').notNull().default(now),
  },
  (table) => ({
    uniq: uniqueIndex('attempts_assignment_user_idx').on(table.assignmentId, table.userId),
    userIdx: index('attempts_user_idx').on(table.userId, table.status),
  }),
);

export const attemptAnswers = sqliteTable(
  'attempt_answers',
  {
    attemptId: integer('attempt_id')
      .notNull()
      .references(() => attempts.id, { onDelete: 'cascade' }),
    questionId: text('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    responseJson: text('response_json').notNull(),
    isCorrect: integer('is_correct', { mode: 'boolean' }),
    points: real('points'),
    pointsMax: real('points_max'),
    answeredAt: integer('answered_at').notNull().default(now),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.attemptId, table.questionId] }),
    questionIdx: index('attempt_answers_question_idx').on(table.questionId),
  }),
);

/**
 * Guarantees a student never receives the same question twice.
 * Rows are written at draw time rather than at submit time, so two assignments
 * created back to back cannot produce overlapping questions.
 */
export const userQuestionHistory = sqliteTable(
  'user_question_history',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    questionId: text('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    attemptId: integer('attempt_id').references(() => attempts.id, { onDelete: 'set null' }),
    seenAt: integer('seen_at').notNull().default(now),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.questionId] }),
  }),
);

/**
 * Earlier finished runs of an attempt that was reset for a retake.
 *
 * Resetting reuses the same draw, so without this the first score -- the only
 * one taken before the child saw the answer key -- would be lost.
 */
export const attemptRuns = sqliteTable(
  'attempt_runs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    attemptId: integer('attempt_id')
      .notNull()
      .references(() => attempts.id, { onDelete: 'cascade' }),
    runNo: integer('run_no').notNull(),
    startedAt: integer('started_at'),
    submittedAt: integer('submitted_at'),
    elapsedSeconds: integer('elapsed_seconds'),
    scorePoints: real('score_points'),
    scoreMax: real('score_max'),
    scorePercent: real('score_percent'),
    scoreBreakdownJson: text('score_breakdown_json'),
    /** {questionId: {response, points, isCorrect}} at the time of the reset. */
    answersJson: text('answers_json').notNull(),
    archivedBy: integer('archived_by'),
    archivedAt: integer('archived_at').notNull().default(now),
  },
  (table) => ({
    attemptIdx: index('attempt_runs_attempt_idx').on(table.attemptId, table.runNo),
  }),
);

/** A student, parent or admin pointing out a wrong key, typo or broken figure. */
export const questionReports = sqliteTable(
  'question_reports',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    questionId: text('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    attemptId: integer('attempt_id').references(() => attempts.id, { onDelete: 'set null' }),
    pesan: text('pesan').notNull(),
    createdAt: integer('created_at').notNull().default(now),
    resolvedAt: integer('resolved_at'),
  },
  (table) => ({
    openIdx: index('question_reports_open_idx').on(table.resolvedAt, table.questionId),
  }),
);

/**
 * Server-wide switches an admin can flip from the panel, as key/value pairs.
 * A missing row means the default; see src/domain/settings.ts.
 */
export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull().default(now),
});

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type ParentChildRow = typeof parentChildren.$inferSelect;
export type QuestionRow = typeof questions.$inferSelect;
export type StimulusRow = typeof stimuli.$inferSelect;
export type AssignmentRow = typeof assignments.$inferSelect;
export type AssignmentSectionRow = typeof assignmentSections.$inferSelect;
export type AttemptRow = typeof attempts.$inferSelect;
export type AttemptAnswerRow = typeof attemptAnswers.$inferSelect;
export type AttemptRunRow = typeof attemptRuns.$inferSelect;
export type QuestionReportRow = typeof questionReports.$inferSelect;
