import Link from 'next/link';
import { sqlite } from '@/db/client';
import { setRankingEnabled, setRankingHidden } from '@/actions/ranking';
import { ActionForm } from '@/components/ActionForm';
import { visibleStudentIds } from '@/domain/access';
import { SUBJECTS, SUBJECT_SHORT, type Subject } from '@/domain/blueprint';
import {
  MIN_RANKING_ITEMS,
  RANKING_WINDOW_DAYS,
  computeRanking,
  windowStart,
  type RankingRow,
} from '@/domain/ranking';
import { displayScore } from '@/domain/scoring';
import { isRankingEnabled } from '@/domain/settings';
import type { SessionUser } from '@/lib/auth';
import { closeExpiredFor } from '@/lib/grading';
import { avatarClass, initials, scoreTone } from '@/lib/ui';

/**
 * The shared ranking board, for every role.
 *
 * Students and parents see every ranked child here -- the one deliberate read
 * across families -- so the board shows aggregates only and links nowhere.
 * The admin gets the same board plus the on/off switch and per-student hiding.
 */

type Mapel = Subject | 'semua';
type Periode = '30' | 'semua';

export type RankingSearch = { mapel?: string; periode?: string };

function parseSearch(search: RankingSearch): { mapel: Mapel; periode: Periode } {
  const mapel = (SUBJECTS as readonly string[]).includes(search.mapel ?? '')
    ? (search.mapel as Subject)
    : 'semua';
  const periode = search.periode === 'semua' ? 'semua' : '30';
  return { mapel, periode };
}

type Props = {
  actor: SessionUser;
  basePath: string;
  search: RankingSearch;
};

const MEDAL = ['bg-amber-400 text-amber-950', 'bg-slate-300 text-slate-900', 'bg-orange-300 text-orange-950'];

export function RankingView({ actor, basePath, search }: Props) {
  const isAdmin = actor.role === 'admin';
  const enabled = isRankingEnabled(sqlite);

  if (!enabled && !isAdmin) {
    return (
      <div>
        <h1 className="text-2xl font-bold">Peringkat</h1>
        <p className="mt-6 rounded-2xl border border-line bg-surface p-8 text-center text-muted">
          Peringkat sedang dinonaktifkan oleh admin.
        </p>
      </div>
    );
  }

  const { mapel, periode } = parseSearch(search);
  const since = periode === '30' ? windowStart(RANKING_WINDOW_DAYS) : null;

  // Lapsed attempts are graded first, so they count on the board.
  closeExpiredFor(null);
  const { ranked, unqualified } = computeRanking(sqlite, {
    subject: mapel === 'semua' ? null : mapel,
    since,
  });

  const mine = new Set(isAdmin ? [] : visibleStudentIds(sqlite, actor));
  const myRows = [...ranked, ...unqualified].filter((r) => mine.has(r.studentId));
  const hidden = isAdmin
    ? (sqlite
        .prepare("SELECT id, nama FROM users WHERE role = 'student' AND ranking_hidden = 1 ORDER BY nama")
        .all() as { id: number; nama: string }[])
    : [];

  const href = (next: Partial<{ mapel: Mapel; periode: Periode }>) => {
    const params = new URLSearchParams({ mapel: next.mapel ?? mapel, periode: next.periode ?? periode });
    return `${basePath}?${params}`;
  };
  const tab = (active: boolean) =>
    `rounded-lg px-3 py-1.5 text-sm font-medium transition ${
      active ? 'bg-brand text-white' : 'border border-line text-muted hover:border-brand hover:text-ink'
    }`;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Peringkat</h1>
          <p className="mt-1 text-sm text-muted">
            Rata-rata nilai dari semua tugas yang sudah selesai. Murid masuk peringkat setelah
            mengerjakan minimal {MIN_RANKING_ITEMS} soal.
          </p>
        </div>
        {isAdmin ? (
          <ActionForm action={setRankingEnabled}>
            <input type="hidden" name="enabled" value={enabled ? '0' : '1'} />
            <button
              type="submit"
              className="rounded-lg border border-line px-3 py-2 text-sm font-medium transition hover:border-brand"
            >
              {enabled ? 'Nonaktifkan peringkat' : 'Aktifkan peringkat'}
            </button>
          </ActionForm>
        ) : null}
      </div>

      {isAdmin && !enabled ? (
        <p role="status" className="mt-4 rounded-xl bg-warnsoft px-4 py-3 text-sm text-warn">
          Peringkat sedang <strong>nonaktif</strong>: murid dan orang tua tidak bisa membukanya.
        </p>
      ) : null}

      <nav aria-label="Mata pelajaran" className="mt-5 flex flex-wrap gap-2">
        <Link href={href({ mapel: 'semua' })} className={tab(mapel === 'semua')}>
          Semua mapel
        </Link>
        {SUBJECTS.map((subject) => (
          <Link key={subject} href={href({ mapel: subject })} className={tab(mapel === subject)}>
            {SUBJECT_SHORT[subject]}
          </Link>
        ))}
      </nav>
      <nav aria-label="Periode" className="mt-2 flex flex-wrap gap-2">
        <Link href={href({ periode: '30' })} className={tab(periode === '30')}>
          {RANKING_WINDOW_DAYS} hari terakhir
        </Link>
        <Link href={href({ periode: 'semua' })} className={tab(periode === 'semua')}>
          Sepanjang waktu
        </Link>
      </nav>

      {myRows.length > 0 ? (
        <ul className="mt-5 grid gap-3 sm:grid-cols-2">
          {myRows.map((row) => (
            <li key={row.studentId} className="rounded-2xl border border-brand/40 bg-brandsoft p-4">
              <p className="text-sm text-muted">
                {actor.role === 'student' ? 'Peringkat kamu' : `Peringkat ${row.nama}`}
              </p>
              {row.rank > 0 ? (
                <p className="mt-1 text-2xl font-bold">
                  {row.rank} <span className="text-base font-medium text-muted">dari {ranked.length}</span>
                </p>
              ) : (
                <p className="mt-1 font-semibold">
                  Belum masuk peringkat · {row.items}/{MIN_RANKING_ITEMS} soal
                </p>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {ranked.length === 0 ? (
        <p className="mt-5 rounded-2xl border border-line bg-surface p-8 text-center text-muted">
          Belum ada murid yang masuk peringkat untuk pilihan ini.
        </p>
      ) : (
        <ol className="mt-5 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {ranked.map((row) => (
            <BoardRow key={row.studentId} row={row} highlight={mine.has(row.studentId)} isAdmin={isAdmin} />
          ))}
        </ol>
      )}

      {unqualified.length > 0 ? (
        <section className="mt-6">
          <h2 className="text-sm font-semibold text-muted">Belum cukup soal</h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {unqualified.map((row) => (
              <li
                key={row.studentId}
                className={`rounded-full border px-3 py-1 text-sm ${
                  mine.has(row.studentId) ? 'border-brand/50 bg-brandsoft' : 'border-line'
                }`}
              >
                {row.nama} <span className="text-muted">· {row.items}/{MIN_RANKING_ITEMS}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {isAdmin && hidden.length > 0 ? (
        <section className="mt-6">
          <h2 className="text-sm font-semibold text-muted">Disembunyikan dari peringkat</h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {hidden.map((student) => (
              <li key={student.id} className="flex items-center gap-2 rounded-full border border-line py-1 pr-1 pl-3 text-sm">
                {student.nama}
                <ActionForm action={setRankingHidden}>
                  <input type="hidden" name="id" value={student.id} />
                  <input type="hidden" name="hidden" value="0" />
                  <button type="submit" className="rounded-full bg-surface2 px-2 py-0.5 text-xs font-medium hover:text-brand">
                    Tampilkan lagi
                  </button>
                </ActionForm>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="mt-6 text-xs text-muted">
        Setiap murid mendapat soal berbeda, jadi peringkat adalah gambaran, bukan nilai resmi.
      </p>
    </div>
  );
}

function BoardRow({ row, highlight, isAdmin }: { row: RankingRow; highlight: boolean; isAdmin: boolean }) {
  return (
    <li className={`flex items-center gap-3 px-4 py-3 ${highlight ? 'bg-brandsoft' : ''}`}>
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
          MEDAL[row.rank - 1] ?? 'bg-surface2 text-muted'
        }`}
        aria-label={`Peringkat ${row.rank}`}
      >
        {row.rank}
      </span>
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${avatarClass(row.avatarWarna)}`}
        aria-hidden="true"
      >
        {initials(row.nama)}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate ${highlight ? 'font-bold' : 'font-medium'}`}>{row.nama}</span>
        <span className="block text-xs text-muted">
          {row.items} soal · {row.attempts} tugas
        </span>
      </span>
      <span className={`text-lg font-bold tabular-nums ${scoreTone(row.percent)}`}>
        {displayScore(row.percent)}
      </span>
      {isAdmin ? (
        <ActionForm action={setRankingHidden}>
          <input type="hidden" name="id" value={row.studentId} />
          <input type="hidden" name="hidden" value="1" />
          <button
            type="submit"
            className="rounded-lg border border-line px-2 py-1 text-xs font-medium text-muted transition hover:border-brand hover:text-ink"
          >
            Sembunyikan
          </button>
        </ActionForm>
      ) : null}
    </li>
  );
}
