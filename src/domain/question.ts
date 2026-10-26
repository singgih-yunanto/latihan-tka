import { z } from 'zod';
import { figureSchema, type Figure } from './figure';
import {
  DIFFICULTIES,
  QUESTION_TYPES,
  SUBJECTS,
  allCompetencyKeys,
  allDomainKeys,
  type Difficulty,
  type QuestionType,
  type Subject,
} from './blueprint';

/**
 * The shape of a question item, shared by the bank validator, the scoring
 * engine and the rendering components.
 */

const idSlug = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9-]+$/, 'lowercase letters, digits and hyphens only');

/** An option, for both simple multiple choice and multi-answer questions. */
export const choiceSchema = z.object({
  id: z.string().min(1).max(16),
  text: z.string().min(1),
  figure: figureSchema.optional(),
});
export type Choice = z.infer<typeof choiceSchema>;

/** A statement in a category question (e.g. true/false per row). */
export const statementSchema = z.object({
  id: z.string().min(1).max(16),
  text: z.string().min(1),
  figure: figureSchema.optional(),
});
export type Statement = z.infer<typeof statementSchema>;

export const categorySchema = z.object({
  id: z.string().min(1).max(16),
  label: z.string().min(1).max(40),
});
export type Category = z.infer<typeof categorySchema>;

/** Contents of options_json -- the shape depends on the question type. */
export type QuestionBody =
  | { kind: 'choices'; choices: Choice[] }
  | { kind: 'kategori'; statements: Statement[]; categories: Category[] };

/** Contents of answer_json -- the answer key. */
export type AnswerKey =
  | { kind: 'single'; correct: string }
  | { kind: 'multi'; correct: string[] }
  | { kind: 'kategori'; correct: Record<string, string> };

/** A student's response. */
export type Response =
  | { kind: 'single'; choice: string | null }
  | { kind: 'multi'; choices: string[] }
  | { kind: 'kategori'; picks: Record<string, string> };

/**
 * Runtime shapes for the three JSON types above.
 *
 * Responses arrive from the browser through a Server Action, and every JSON
 * column can in principle hold anything, so nothing is trusted on its type
 * alone. Ids are short strings and lists are bounded so a hostile client cannot
 * store megabytes per answer.
 */
const optionId = z.string().min(1).max(16);

export const responseSchema: z.ZodType<Response> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('single'), choice: optionId.nullable() }),
  z.object({ kind: z.literal('multi'), choices: z.array(optionId).max(26) }),
  z.object({
    kind: z.literal('kategori'),
    picks: z.record(optionId, optionId).refine((r) => Object.keys(r).length <= 26, 'too many picks'),
  }),
]);

export const answerKeySchema: z.ZodType<AnswerKey> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('single'), correct: z.string() }),
  z.object({ kind: z.literal('multi'), correct: z.array(z.string()) }),
  z.object({ kind: z.literal('kategori'), correct: z.record(z.string(), z.string()) }),
]);

const choiceListSchema = z.array(
  z.object({ id: z.string(), text: z.string(), figure: z.any().optional() }).passthrough(),
);

export const questionBodySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('choices'), choices: choiceListSchema }),
  z.object({
    kind: z.literal('kategori'),
    statements: choiceListSchema,
    categories: z.array(z.object({ id: z.string(), label: z.string() })),
  }),
]) as unknown as z.ZodType<QuestionBody>;

/** Parse a JSON column against a schema; null when unreadable or malformed. */
export function parseJsonAs<T>(schema: z.ZodType<T>, json: string | null | undefined): T | null {
  if (json == null) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export const idListSchema = z.array(z.string().min(1).max(64)).max(500);
export const optionOrdersSchema = z.record(z.string(), z.array(z.string()));

export const parseResponse = (json: string | null | undefined) => parseJsonAs(responseSchema, json);
export const parseAnswerKey = (json: string | null | undefined) => parseJsonAs(answerKeySchema, json);
export const parseQuestionBody = (json: string | null | undefined) =>
  parseJsonAs(questionBodySchema, json);
export const parseIdList = (json: string | null | undefined) => parseJsonAs(idListSchema, json) ?? [];
export const parseOptionOrders = (json: string | null | undefined) =>
  parseJsonAs(optionOrdersSchema, json) ?? {};

export function emptyResponse(type: QuestionType): Response {
  switch (type) {
    case 'pg':
      return { kind: 'single', choice: null };
    case 'pgk_multi':
      return { kind: 'multi', choices: [] };
    case 'pgk_kategori':
      return { kind: 'kategori', picks: {} };
  }
}

export function isAnswered(response: Response): boolean {
  switch (response.kind) {
    case 'single':
      return response.choice !== null;
    case 'multi':
      return response.choices.length > 0;
    case 'kategori':
      return Object.keys(response.picks).length > 0;
  }
}

/**
 * Options whose meaning depends on position ("all of the above", "A and B")
 * cannot be used, because option order is shuffled for every student.
 */
const POSITIONAL_PATTERNS: RegExp[] = [
  /^\s*semua (jawaban )?(di atas )?benar/i,
  /^\s*semua (jawaban )?(di atas )?salah/i,
  /^\s*tidak ada (jawaban )?yang benar/i,
  /^\s*jawaban [a-d] dan [a-d]/i,
  /^\s*[a-d] dan [a-d]\s*$/i,
  /^\s*pilihan [a-d]\b/i,
  /di atas semua/i,
];

export function positionalOptionIssue(text: string): string | null {
  for (const pattern of POSITIONAL_PATTERNS) {
    if (pattern.test(text)) {
      return `option "${text}" depends on position, but option order is shuffled`;
    }
  }
  return null;
}

/**
 * The numeric value of an option, when that option is nothing but a number.
 * KaTeX markers, thousands separators and simple units are ignored; a comma is
 * treated as the decimal separator, following Indonesian convention.
 * Returns null when the option is not purely a number.
 */
export function numericValueOf(text: string): number | null {
  const bare = text
    .replace(/\$/g, '')
    .replace(/\{,\}/g, ',')
    .replace(/\\%|%/g, '')
    .replace(/[\s\u00a0]/g, '')
    .replace(/^(rp|±)/i, '')
    .replace(/(cm|mm|km|kg|ml|liter|l|m)(\^?\{?[23]\}?)?$/i, '');

  if (!/^-?[\d.,]+$/.test(bare)) return null;

  const normalized = bare.replace(/\./g, '').replace(',', '.');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** A single question as written in a bank file. */
export const bankQuestionSchema = z
  .object({
    id: idSlug,
    subject: z.enum(SUBJECTS),
    domain: z.string().min(1),
    competency: z.string().min(1),
    difficulty: z.enum(DIFFICULTIES),
    type: z.enum(QUESTION_TYPES),
    stimulusId: idSlug.optional(),
    stem: z.string().min(5),
    figure: figureSchema.optional(),
    choices: z.array(choiceSchema).optional(),
    statements: z.array(statementSchema).optional(),
    categories: z.array(categorySchema).optional(),
    answer: z.union([z.string(), z.array(z.string()), z.record(z.string())]),
    explanation: z.string().min(5),
    explanationFigure: figureSchema.optional(),
  })
  .superRefine((q, ctx) => {
    const fail = (message: string, path: (string | number)[] = []) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });

    if (!allDomainKeys(q.subject).includes(q.domain)) {
      fail(`unknown strand "${q.domain}" for subject ${q.subject}`, ['domain']);
    }
    if (!allCompetencyKeys(q.subject).includes(q.competency)) {
      fail(`unknown competency "${q.competency}" for subject ${q.subject}`, ['competency']);
    }

    if (q.type === 'pgk_kategori') {
      if (!q.statements || q.statements.length < 2) {
        fail('pgk_kategori needs at least 2 statements', ['statements']);
        return;
      }
      if (!q.categories || q.categories.length < 2) {
        fail('pgk_kategori needs at least 2 categories', ['categories']);
        return;
      }
      const statementIds = new Set(q.statements.map((s) => s.id));
      const categoryIds = new Set(q.categories.map((c) => c.id));
      if (statementIds.size !== q.statements.length) fail('duplicate statement id', ['statements']);
      if (categoryIds.size !== q.categories.length) fail('duplicate category id', ['categories']);

      if (typeof q.answer !== 'object' || Array.isArray(q.answer)) {
        fail('a pgk_kategori answer must be an object {statementId: categoryId}', ['answer']);
        return;
      }
      for (const sid of statementIds) {
        if (!(sid in q.answer)) fail(`statement "${sid}" has no answer key`, ['answer']);
      }
      for (const [sid, cid] of Object.entries(q.answer)) {
        if (!statementIds.has(sid)) fail(`the key references statement "${sid}", which does not exist`, ['answer']);
        if (!categoryIds.has(cid)) fail(`the key references category "${cid}", which does not exist`, ['answer']);
      }
      return;
    }

    // pg and pgk_multi
    if (!q.choices || q.choices.length < 3) {
      fail(`${q.type} needs at least 3 options`, ['choices']);
      return;
    }
    const choiceIds = new Set(q.choices.map((c) => c.id));
    if (choiceIds.size !== q.choices.length) fail('duplicate option id', ['choices']);

    q.choices.forEach((choice, index) => {
      const issue = positionalOptionIssue(choice.text);
      if (issue) fail(issue, ['choices', index]);
    });

    const texts = q.choices.map((c) => c.text.trim().toLowerCase());
    if (new Set(texts).size !== texts.length) fail('two options have identical text', ['choices']);

    // Two options can be written differently yet mean the same number, e.g.
    // "0,72" and "0,720". One of them is certainly a broken distractor.
    const numerics = new Map<number, string>();
    for (const choice of q.choices) {
      const value = numericValueOf(choice.text);
      if (value === null) continue;
      const kembar = numerics.get(value);
      if (kembar !== undefined) {
        fail(`option "${choice.text}" has the same value as "${kembar}"`, ['choices']);
      } else {
        numerics.set(value, choice.text);
      }
    }

    if (q.type === 'pg') {
      if (typeof q.answer !== 'string') {
        fail('a pg answer must be a single option id', ['answer']);
        return;
      }
      if (!choiceIds.has(q.answer)) fail(`key "${q.answer}" is not among the options`, ['answer']);
    } else {
      if (!Array.isArray(q.answer)) {
        fail('a pgk_multi answer must be an array of option ids', ['answer']);
        return;
      }
      if (q.answer.length < 2) fail('pgk_multi needs at least 2 answer keys', ['answer']);
      if (q.answer.length >= q.choices.length) {
        fail('a pgk_multi key may not cover every option', ['answer']);
      }
      for (const id of q.answer) {
        if (!choiceIds.has(id)) fail(`key "${id}" is not among the options`, ['answer']);
      }
      if (new Set(q.answer).size !== q.answer.length) fail('duplicate pgk_multi key', ['answer']);
    }
  });

export type BankQuestion = z.infer<typeof bankQuestionSchema>;

export const bankStimulusSchema = z.object({
  id: idSlug,
  subject: z.enum(SUBJECTS),
  title: z.string().min(3),
  textType: z.string().min(2),
  body: z.string().min(50),
  figure: figureSchema.optional(),
  source: z.string().optional(),
});
export type BankStimulus = z.infer<typeof bankStimulusSchema>;

export const bankFileSchema = z.object({
  batch: z.string().min(2),
  note: z.string().optional(),
  stimuli: z.array(bankStimulusSchema).default([]),
  questions: z.array(bankQuestionSchema).default([]),
});
export type BankFile = z.infer<typeof bankFileSchema>;

/** Split a bank item into body plus key for storage in the database. */
export function splitQuestion(q: BankQuestion): { body: QuestionBody; answer: AnswerKey } {
  if (q.type === 'pgk_kategori') {
    return {
      body: { kind: 'kategori', statements: q.statements!, categories: q.categories! },
      answer: { kind: 'kategori', correct: q.answer as Record<string, string> },
    };
  }
  if (q.type === 'pgk_multi') {
    return {
      body: { kind: 'choices', choices: q.choices! },
      answer: { kind: 'multi', correct: q.answer as string[] },
    };
  }
  return {
    body: { kind: 'choices', choices: q.choices! },
    answer: { kind: 'single', correct: q.answer as string },
  };
}

/** The ids whose order gets shuffled for a given item. */
export function shufflableIds(body: QuestionBody): string[] {
  return body.kind === 'choices'
    ? body.choices.map((c) => c.id)
    : body.statements.map((s) => s.id);
}

export type { Figure, Subject, QuestionType, Difficulty };

/**
 * The parts of an item that decide its score, frozen into the attempt when it
 * is drawn (attempts.item_snapshot_json). Stem and explanation text are left
 * live so typo fixes still reach old reviews; the options and the key are not,
 * so a corrected key never contradicts a score already given.
 */
export type ItemSnapshot = { type: QuestionType; body: QuestionBody; answer: AnswerKey };

const itemSnapshotsSchema = z.record(
  z.string(),
  z.object({ type: z.enum(QUESTION_TYPES), body: questionBodySchema, answer: answerKeySchema }),
) as unknown as z.ZodType<Record<string, ItemSnapshot>>;

export const parseSnapshots = (json: string | null | undefined): Record<string, ItemSnapshot> =>
  parseJsonAs(itemSnapshotsSchema, json) ?? {};

/** The scoring-relevant view of a question row, preferring the frozen copy. */
export function effectiveItem(
  row: { type: string; optionsJson: string; answerJson: string },
  snapshot: ItemSnapshot | undefined,
): { type: QuestionType; body: QuestionBody | null; answer: AnswerKey | null } {
  if (snapshot) return snapshot;
  return {
    type: row.type as QuestionType,
    body: parseQuestionBody(row.optionsJson),
    answer: parseAnswerKey(row.answerJson),
  };
}
