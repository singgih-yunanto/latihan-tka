import { and, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { db } from '@/db/client';
import { assignments, attempts, users } from '@/db/schema';
import type { Subject } from '@/domain/blueprint';
import { parseIdList } from '@/domain/question';
import { parseBreakdown } from '@/domain/scoring';
import { APP_TIMEZONE } from '@/lib/ui';

/** Results as CSV, for the admin (everyone) and for a parent (their children). */

/** Byte order mark, so Excel recognises the file as UTF-8. */
const BOM = String.fromCharCode(0xfeff);

/**
 * One CSV cell.
 *
 * A cell starting with = + - @ (or a tab/CR) is a formula to Excel and
 * LibreOffice, and assignment titles are typed by parents -- so such text is
 * prefixed with an apostrophe, the standard neutraliser. Plain numbers are
 * left alone so they stay numeric.
 */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (typeof value !== 'number' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",;\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** "2026-10-25 14:05" in the app's timezone, which spreadsheets parse as a date. */
function localTimestamp(epochSeconds: number | null): string {
  if (!epochSeconds) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(epochSeconds * 1000));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

/**
 * `scope` is the student ids the viewer may see, or null for an admin. The
 * filtering happens in SQL, and only the columns the file needs are selected --
 * in particular no password hashes are ever loaded for an export.
 */
export function buildResultsCsv(scope: number[] | null, assignmentId: number | null): Response {
  const where: SQL[] = [];
  if (scope !== null) where.push(scope.length ? inArray(attempts.userId, scope) : eq(attempts.id, -1));
  if (assignmentId !== null) where.push(eq(attempts.assignmentId, assignmentId));

  const baris = db
    .select({
      nama: users.nama,
      judul: assignments.judul,
      status: attempts.status,
      questionOrderJson: attempts.questionOrderJson,
      scorePercent: attempts.scorePercent,
      scorePoints: attempts.scorePoints,
      scoreMax: attempts.scoreMax,
      elapsedSeconds: attempts.elapsedSeconds,
      startedAt: attempts.startedAt,
      submittedAt: attempts.submittedAt,
      dueAt: assignments.dueAt,
      breakdown: attempts.scoreBreakdownJson,
    })
    .from(attempts)
    .innerJoin(assignments, eq(attempts.assignmentId, assignments.id))
    .innerJoin(users, eq(attempts.userId, users.id))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(attempts.id))
    .all();

  const header = [
    'murid',
    'penugasan',
    'status',
    'jumlah_soal',
    'nilai',
    'poin',
    'poin_maks',
    'waktu_detik',
    'mulai',
    'selesai',
    'tenggat',
    'nilai_bahasa_indonesia',
    'nilai_matematika',
    'nilai_ipas',
  ];

  const nilaiMapel = (json: string | null, subject: Subject): string => {
    const found = parseBreakdown(json).bySubject.find((item) => item.key === subject);
    return found ? String(found.percent) : '';
  };

  const lines = [header.join(',')];
  for (const row of baris) {
    lines.push(
      [
        row.nama,
        row.judul,
        row.status,
        parseIdList(row.questionOrderJson).length,
        row.scorePercent ?? '',
        row.scorePoints ?? '',
        row.scoreMax ?? '',
        row.elapsedSeconds ?? '',
        localTimestamp(row.startedAt),
        localTimestamp(row.submittedAt),
        localTimestamp(row.dueAt),
        nilaiMapel(row.breakdown, 'bahasa_indonesia'),
        nilaiMapel(row.breakdown, 'matematika'),
        nilaiMapel(row.breakdown, 'ipas'),
      ]
        .map(csvCell)
        .join(','),
    );
  }

  const namaBerkas = assignmentId ? `hasil-tka-penugasan-${assignmentId}.csv` : 'hasil-tka.csv';
  return new Response(BOM + lines.join('\r\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${namaBerkas}"`,
      'Cache-Control': 'no-store',
    },
  });
}

/** `?penugasan=12` -> 12; anything else -> null. */
export function assignmentFilter(request: Request): number | null {
  const raw = new URL(request.url).searchParams.get('penugasan');
  const id = raw ? Number(raw) : NaN;
  return Number.isInteger(id) && id > 0 ? id : null;
}
