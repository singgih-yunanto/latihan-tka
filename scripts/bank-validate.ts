import { allQuestions, validateBank } from './bank-lib';

/** Check every question bank file without touching the database. */
function main() {
  const { files, issues } = validateBank();
  const total = allQuestions(files).length;

  console.log(`Checking ${files.length} bank files (${total} questions).`);

  if (issues.length === 0) {
    console.log('All questions passed.');
    return;
  }

  const byFile = new Map<string, typeof issues>();
  for (const issue of issues) {
    const list = byFile.get(issue.file) ?? [];
    list.push(issue);
    byFile.set(issue.file, list);
  }

  for (const [file, list] of byFile) {
    console.error(`\n${file}`);
    for (const issue of list) {
      console.error(`  [${issue.where}] ${issue.message}`);
    }
  }

  console.error(`\n${issues.length} problem(s) found.`);
  process.exit(1);
}

main();
