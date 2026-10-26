import fs from 'node:fs';
import path from 'node:path';
import { bankFileSchema, type BankFile, type BankQuestion, type BankStimulus } from '../src/domain/question';
import { fingerprintOf } from '../src/domain/fingerprint';
import { svgRemovals } from '../src/lib/svg-sanitize';

/** Shared bank loading and checking between bank:validate and bank:sync. */

export const BANK_DIR = path.resolve(process.cwd(), 'content/bank');
export const ASSETS_DIR = path.resolve(process.cwd(), 'content/assets');
export const PUBLIC_ASSETS_DIR = path.resolve(process.cwd(), 'public/bank-assets');

export type LoadedFile = {
  file: string;
  data: BankFile;
};

export type BankIssue = {
  file: string;
  where: string;
  message: string;
};

export function listBankFiles(): string[] {
  if (!fs.existsSync(BANK_DIR)) return [];
  return fs
    .readdirSync(BANK_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => path.join(BANK_DIR, f));
}

/** Load every bank file; schema errors are returned rather than thrown. */
export function loadBank(): { files: LoadedFile[]; issues: BankIssue[] } {
  const files: LoadedFile[] = [];
  const issues: BankIssue[] = [];

  for (const full of listBankFiles()) {
    const name = path.basename(full);
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch (error) {
      issues.push({ file: name, where: '-', message: `invalid JSON: ${(error as Error).message}` });
      continue;
    }

    const parsed = bankFileSchema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const where = issue.path.join('.') || '-';
        issues.push({ file: name, where, message: issue.message });
      }
      continue;
    }
    files.push({ file: name, data: parsed.data });
  }

  return { files, issues };
}

/** Checks that are only possible once every file has been read. */
export function crossFileIssues(files: readonly LoadedFile[]): BankIssue[] {
  const issues: BankIssue[] = [];
  const questionIds = new Map<string, string>();
  const stimulusIds = new Map<string, string>();
  const fingerprints = new Map<string, string>();

  for (const { file, data } of files) {
    for (const stimulus of data.stimuli) {
      const seen = stimulusIds.get(stimulus.id);
      if (seen) {
        issues.push({ file, where: stimulus.id, message: `stimulus id already used in ${seen}` });
      } else {
        stimulusIds.set(stimulus.id, file);
      }
    }
  }

  for (const { file, data } of files) {
    for (const question of data.questions) {
      const seen = questionIds.get(question.id);
      if (seen) {
        issues.push({ file, where: question.id, message: `question id already used in ${seen}` });
      } else {
        questionIds.set(question.id, file);
      }

      if (question.stimulusId && !stimulusIds.has(question.stimulusId)) {
        issues.push({
          file,
          where: question.id,
          message: `references stimulus "${question.stimulusId}", which is not in the bank`,
        });
      }

      const fp = fingerprintOf(question);
      const kembar = fingerprints.get(fp);
      if (kembar) {
        issues.push({ file, where: question.id, message: `content duplicates question ${kembar}` });
      } else {
        fingerprints.set(fp, question.id);
      }
    }
  }

  return issues;
}

/**
 * Every inline SVG must come through the render-time sanitiser untouched. The
 * regex checks in the schema catch the common mistakes with readable messages;
 * this is the authoritative allowlist, the same one the pages apply.
 */
export function svgSanitizerIssues(files: readonly LoadedFile[]): BankIssue[] {
  const issues: BankIssue[] = [];
  const visit = (file: string, where: string, value: unknown) => {
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    if (node.kind === 'svg' && typeof node.svg === 'string') {
      for (const message of new Set(svgRemovals(node.svg))) {
        issues.push({ file, where, message: `SVG: ${message}` });
      }
      return;
    }
    for (const child of Object.values(node)) visit(file, where, child);
  };
  for (const { file, data } of files) {
    for (const stimulus of data.stimuli) visit(file, stimulus.id, stimulus);
    for (const question of data.questions) visit(file, question.id, question);
  }
  return issues;
}

/** Raster figures referenced but missing from content/assets. */
export function missingAssetIssues(files: readonly LoadedFile[]): BankIssue[] {
  const issues: BankIssue[] = [];
  const check = (file: string, where: string, src: string) => {
    const full = path.resolve(ASSETS_DIR, src);
    if (!full.startsWith(ASSETS_DIR)) {
      issues.push({ file, where, message: `src "${src}" points outside content/assets` });
      return;
    }
    if (!fs.existsSync(full)) {
      issues.push({ file, where, message: `figure file "${src}" not found in content/assets` });
    }
  };

  for (const { file, data } of files) {
    for (const stimulus of data.stimuli) {
      if (stimulus.figure?.kind === 'image') check(file, stimulus.id, stimulus.figure.src);
    }
    for (const question of data.questions) {
      if (question.figure?.kind === 'image') check(file, question.id, question.figure.src);
      if (question.explanationFigure?.kind === 'image') {
        check(file, question.id, question.explanationFigure.src);
      }
      for (const choice of question.choices ?? []) {
        if (choice.figure?.kind === 'image') check(file, `${question.id}/${choice.id}`, choice.figure.src);
      }
      for (const statement of question.statements ?? []) {
        if (statement.figure?.kind === 'image') {
          check(file, `${question.id}/${statement.id}`, statement.figure.src);
        }
      }
    }
  }
  return issues;
}

export function allQuestions(files: readonly LoadedFile[]): { batch: string; question: BankQuestion }[] {
  return files.flatMap(({ data }) =>
    data.questions.map((question) => ({ batch: data.batch, question })),
  );
}

export function allStimuli(files: readonly LoadedFile[]): { batch: string; stimulus: BankStimulus }[] {
  return files.flatMap(({ data }) =>
    data.stimuli.map((stimulus) => ({ batch: data.batch, stimulus })),
  );
}

/** Run every check. Used by bank:validate and by npm test. */
export function validateBank(): { files: LoadedFile[]; issues: BankIssue[] } {
  const { files, issues } = loadBank();
  return {
    files,
    issues: [
      ...issues,
      ...crossFileIssues(files),
      ...missingAssetIssues(files),
      ...svgSanitizerIssues(files),
    ],
  };
}
