import {
  BLUEPRINT,
  DIFFICULTIES,
  DIFFICULTY_MIX,
  QUESTION_TYPES,
  SUBJECTS,
  SUBJECT_LABEL,
  TYPE_MIX,
  type Subject,
} from '../src/domain/blueprint';
import { allQuestions, validateBank } from './bank-lib';
import type { BankQuestion } from '../src/domain/question';

/** Report question bank coverage against the blueprint targets. */

function bar(actual: number, target: number, width = 22): string {
  if (target <= 0) return '';
  const ratio = Math.min(1, actual / target);
  const filled = Math.round(ratio * width);
  return `${'#'.repeat(filled)}${'.'.repeat(width - filled)}`;
}

function hasFigure(q: BankQuestion): boolean {
  return Boolean(
    q.figure ||
      q.choices?.some((c) => c.figure) ||
      q.statements?.some((s) => s.figure),
  );
}

function main() {
  const { files, issues } = validateBank();
  const questions = allQuestions(files).map(({ question }) => question);

  if (issues.length > 0) {
    console.log(`Note: ${issues.length} problem(s) outstanding (run npm run bank:validate).\n`);
  }

  const grandTotal = questions.length;
  const grandTarget = SUBJECTS.reduce((sum, s) => sum + BLUEPRINT[s].bankTarget, 0);
  console.log(`TKA QUESTION BANK -- ${grandTotal}/${grandTarget} items\n`);

  for (const subject of SUBJECTS) {
    const spec = BLUEPRINT[subject];
    const mine = questions.filter((q) => q.subject === subject);
    const tag = spec.provisional ? ' (provisional blueprint)' : '';

    console.log(
      `${SUBJECT_LABEL[subject].toUpperCase()}${tag}  ${mine.length}/${spec.bankTarget}  ${bar(mine.length, spec.bankTarget)}`,
    );

    console.log('  Strands:');
    for (const domain of spec.domains) {
      const n = mine.filter((q) => q.domain === domain.key).length;
      const flag = n >= domain.target ? ' ' : '!';
      console.log(
        `   ${flag} ${domain.label.padEnd(32)} ${String(n).padStart(3)}/${String(domain.target).padEnd(3)} ${bar(n, domain.target)}`,
      );
    }

    console.log('  Competencies:');
    for (const competency of spec.competencies) {
      const n = mine.filter((q) => q.competency === competency.key).length;
      const share = mine.length > 0 ? Math.round((n / mine.length) * 100) : 0;
      console.log(`     ${competency.label.padEnd(32)} ${String(n).padStart(3)}  (${share}%)`);
    }

    console.log('  Formats:');
    for (const type of QUESTION_TYPES) {
      const n = mine.filter((q) => q.type === type).length;
      const target = Math.round(spec.bankTarget * TYPE_MIX[type]);
      console.log(`     ${type.padEnd(32)} ${String(n).padStart(3)}/${String(target).padEnd(3)}`);
    }

    console.log('  Difficulty:');
    for (const difficulty of DIFFICULTIES) {
      const n = mine.filter((q) => q.difficulty === difficulty).length;
      const target = Math.round(spec.bankTarget * DIFFICULTY_MIX[difficulty]);
      console.log(`     ${difficulty.padEnd(32)} ${String(n).padStart(3)}/${String(target).padEnd(3)}`);
    }

    const bergambar = mine.filter(hasFigure).length;
    const persen = mine.length > 0 ? Math.round((bergambar / mine.length) * 100) : 0;
    console.log(`  With figures: ${bergambar}/${mine.length} (${persen}%)`);
    console.log('');
  }

  const stimuli = files.flatMap((f) => f.data.stimuli);
  console.log(`Stimuli (reading passages): ${stimuli.length}`);

  const kurang: string[] = [];
  for (const subject of SUBJECTS) {
    const mine = questions.filter((q) => q.subject === subject);
    for (const domain of BLUEPRINT[subject as Subject].domains) {
      const n = mine.filter((q) => q.domain === domain.key).length;
      if (n < domain.target) {
        kurang.push(`${SUBJECT_LABEL[subject]} / ${domain.label}: ${domain.target - n} short`);
      }
    }
  }

  if (kurang.length > 0) {
    console.log('\nStill short of target:');
    for (const line of kurang) console.log(`  - ${line}`);
  } else {
    console.log('\nEvery strand meets its blueprint target.');
  }
}

main();
