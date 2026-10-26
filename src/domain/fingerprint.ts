import crypto from 'node:crypto';
import type { BankQuestion } from './question';

/**
 * Fingerprint of a question's content, used to catch duplicates rewritten under
 * a different id. It hashes what the student actually sees (the stem plus the
 * option or statement text), not the metadata, so retagging a strand does not
 * change the fingerprint.
 */

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,;:!?"'()-]/g, '')
    .trim();
}

export function fingerprintOf(q: BankQuestion): string {
  const parts: string[] = [q.subject, normalize(q.stem)];

  if (q.choices) {
    parts.push(...q.choices.map((c) => normalize(c.text)).sort());
  }
  if (q.statements) {
    parts.push(...q.statements.map((s) => normalize(s.text)).sort());
  }

  return crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
}
