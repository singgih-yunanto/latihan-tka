import { inArray } from 'drizzle-orm';
import { db, sqlite } from '@/db/client';
import { users } from '@/db/schema';
import { assignableStudentIds, type Actor } from '@/domain/access';
import { countPool } from '@/domain/draw';
import { BLUEPRINT, SUBJECTS, isSubject, type Subject } from '@/domain/blueprint';
import type { AssignmentPreset } from '@/components/AssignmentForm';

/**
 * Everything the assignment form needs, shared by the admin and parent pages.
 *
 * The student list is scoped through `assignableStudentIds`, the same rule
 * `createAssignment` enforces, so the form never offers a child the action
 * would then refuse.
 */
export function assignmentFormData(actor: Actor) {
  const blueprint = SUBJECTS.map((subject) => {
    const spec = BLUEPRINT[subject];
    return {
      subject,
      label: spec.label,
      provisional: spec.provisional,
      domains: spec.domains.map((d) => ({ key: d.key, label: d.label })),
      competencies: spec.competencies.map((c) => ({ key: c.key, label: c.label })),
      // Drawable items only: retired ones are not counted.
      tersedia: countPool(sqlite, subject),
    };
  });

  const ids = assignableStudentIds(sqlite, actor);
  const students =
    ids.length === 0
      ? []
      : db
          .select({ id: users.id, nama: users.nama })
          .from(users)
          .where(inArray(users.id, ids))
          .orderBy(users.nama)
          .all();

  return { blueprint, students };
}

/** Items per strand in a remedial practice built from "Latih bagian terlemah". */
export const REMEDIAL_PER_STRAND = 5;

/**
 * Reads a pre-filled form from the URL:
 *   ?untuk=12&latih=matematika:bilangan,ipas:energi_gaya
 * Unknown subjects and strands are ignored, so a stale link degrades to an
 * empty form rather than an error.
 */
export function presetFromSearch(params: { untuk?: string; latih?: string }): AssignmentPreset | undefined {
  const userId = Number(params.untuk);
  const pairs = (params.latih ?? '')
    .split(',')
    .map((pair) => pair.split(':'))
    .filter(
      (pair): pair is [Subject, string] =>
        pair.length === 2 &&
        isSubject(pair[0]) &&
        BLUEPRINT[pair[0] as Subject].domains.some((d) => d.key === pair[1]),
    );
  if (!Number.isInteger(userId) && pairs.length === 0) return undefined;

  const bySubject = new Map<Subject, string[]>();
  for (const [subject, domain] of pairs) {
    bySubject.set(subject, [...(bySubject.get(subject) ?? []), domain]);
  }

  return {
    judul: pairs.length ? 'Latihan bagian yang masih lemah' : undefined,
    userIds: Number.isInteger(userId) && userId > 0 ? [userId] : undefined,
    sections: [...bySubject.entries()].map(([subject, domains]) => ({
      subject,
      domains,
      jumlahSoal: domains.length * REMEDIAL_PER_STRAND,
    })),
  };
}
