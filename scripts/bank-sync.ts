import fs from 'node:fs';
import path from 'node:path';
import { openSqlite } from '../src/db/client';
import { resolveDbPath } from '../src/db/path';
import { splitQuestion } from '../src/domain/question';
import { fingerprintOf } from '../src/domain/fingerprint';
import { ASSETS_DIR, PUBLIC_ASSETS_DIR, allQuestions, allStimuli, validateBank } from './bank-lib';

/**
 * Copy the question bank from content/bank/*.json into the database.
 *
 * Idempotent: running it repeatedly duplicates nothing and never deletes items
 * already used in an attempt. Items missing from the files are merely
 * deactivated (aktif = 0) so past results remain viewable.
 *
 * `aktif` belongs to this script; an admin withdrawing an item from the panel
 * sets `retired_by_admin`, which is never touched here. Editing an item's key
 * or options is safe for past results: every attempt carries a frozen copy
 * (attempts.item_snapshot_json), so only future draws see the change.
 */

function copyAssets(): number {
  if (!fs.existsSync(ASSETS_DIR)) return 0;
  fs.mkdirSync(PUBLIC_ASSETS_DIR, { recursive: true });

  let copied = 0;
  const walk = (dir: string, relative = '') => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const from = path.join(dir, entry.name);
      const rel = path.join(relative, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(path.join(PUBLIC_ASSETS_DIR, rel), { recursive: true });
        walk(from, rel);
      } else {
        fs.copyFileSync(from, path.join(PUBLIC_ASSETS_DIR, rel));
        copied += 1;
      }
    }
  };
  walk(ASSETS_DIR);
  return copied;
}

function main() {
  const { files, issues } = validateBank();
  if (issues.length > 0) {
    console.error(`${issues.length} problem(s) in the question bank. Run "npm run bank:validate" first.`);
    process.exit(1);
  }

  const dbPath = resolveDbPath();
  const sqlite = openSqlite(dbPath);

  const upsertStimulus = sqlite.prepare(
    `INSERT INTO stimuli (id, subject, judul, jenis_teks, body_md, figure_json, sumber, batch)
     VALUES (@id, @subject, @judul, @jenisTeks, @bodyMd, @figureJson, @sumber, @batch)
     ON CONFLICT(id) DO UPDATE SET
       subject = excluded.subject, judul = excluded.judul, jenis_teks = excluded.jenis_teks,
       body_md = excluded.body_md, figure_json = excluded.figure_json,
       sumber = excluded.sumber, batch = excluded.batch`,
  );

  const upsertQuestion = sqlite.prepare(
    `INSERT INTO questions
       (id, subject, content_domain, competency, difficulty, type, stimulus_id, stem_md,
        figure_json, options_json, answer_json, explanation_md, explanation_figure_json,
        fingerprint, batch, aktif)
     VALUES
       (@id, @subject, @contentDomain, @competency, @difficulty, @type, @stimulusId, @stemMd,
        @figureJson, @optionsJson, @answerJson, @explanationMd, @explanationFigureJson,
        @fingerprint, @batch, 1)
     ON CONFLICT(id) DO UPDATE SET
       subject = excluded.subject, content_domain = excluded.content_domain,
       competency = excluded.competency, difficulty = excluded.difficulty,
       type = excluded.type, stimulus_id = excluded.stimulus_id, stem_md = excluded.stem_md,
       figure_json = excluded.figure_json, options_json = excluded.options_json,
       answer_json = excluded.answer_json, explanation_md = excluded.explanation_md,
       explanation_figure_json = excluded.explanation_figure_json,
       fingerprint = excluded.fingerprint, batch = excluded.batch, aktif = 1`,
  );

  const stimuli = allStimuli(files);
  const questions = allQuestions(files);
  const ids = questions.map(({ question }) => question.id);
  let deactivated = 0;

  // Upsert and deactivation in one transaction: a crash between them must not
  // leave the bank half-synced.
  const run = sqlite.transaction(() => {
    for (const { batch, stimulus } of stimuli) {
      upsertStimulus.run({
        id: stimulus.id,
        subject: stimulus.subject,
        judul: stimulus.title,
        jenisTeks: stimulus.textType,
        bodyMd: stimulus.body,
        figureJson: stimulus.figure ? JSON.stringify(stimulus.figure) : null,
        sumber: stimulus.source ?? null,
        batch,
      });
    }

    for (const { batch, question } of questions) {
      const { body, answer } = splitQuestion(question);
      upsertQuestion.run({
        id: question.id,
        subject: question.subject,
        contentDomain: question.domain,
        competency: question.competency,
        difficulty: question.difficulty,
        type: question.type,
        stimulusId: question.stimulusId ?? null,
        stemMd: question.stem,
        figureJson: question.figure ? JSON.stringify(question.figure) : null,
        optionsJson: JSON.stringify(body),
        answerJson: JSON.stringify(answer),
        explanationMd: question.explanation,
        explanationFigureJson: question.explanationFigure
          ? JSON.stringify(question.explanationFigure)
          : null,
        fingerprint: fingerprintOf(question),
        batch,
      });
    }

    // Items no longer present in the files are deactivated rather than
    // deleted, so existing attempts stay intact.
    if (ids.length > 0) {
      const placeholders = ids.map(() => '?').join(',');
      const info = sqlite
        .prepare(`UPDATE questions SET aktif = 0 WHERE aktif = 1 AND id NOT IN (${placeholders})`)
        .run(...ids);
      deactivated = info.changes;
    }
  });
  run();

  const assets = copyAssets();
  sqlite.close();

  console.log(`Question bank synced into ${dbPath}`);
  console.log(`  stimuli   : ${stimuli.length}`);
  console.log(`  questions : ${questions.length}`);
  if (deactivated > 0) console.log(`  deactivated (gone from files): ${deactivated}`);
  if (assets > 0) console.log(`  figures copied to public/bank-assets: ${assets}`);
}

main();
