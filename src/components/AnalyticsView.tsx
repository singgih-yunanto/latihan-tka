import Link from 'next/link';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, sqlite } from '@/db/client';
import { attempts, questions, users } from '@/db/schema';
import { countAvailable } from '@/domain/draw';
import {
  BLUEPRINT,
  SUBJECTS,
  SUBJECT_LABEL,
  competencyLabel,
  domainLabel,
  type Subject,
} from '@/domain/blueprint';
import { displayScore, parseBreakdown, type Breakdown } from '@/domain/scoring';
import { closeExpiredFor } from '@/lib/grading';
import { formatDate, scoreTone } from '@/lib/ui';

/**
 * Strengths, weaknesses and item difficulty.
 *
 * `scope` limits the per-student section to the students this viewer may see;
 * null means an admin looking at everyone. Item analysis aggregates every
 * child's answers, so it is only shown to an admin.
 */

/** Merge the breakdowns of many attempts into a single picture. */
function gabung(items: Breakdown[][]): Breakdown[] {
  const map = new Map<string, Breakdown>();
  for (const list of items) {
    for (const item of list) {
      const entry = map.get(item.key) ?? {
        key: item.key,
        points: 0,
        pointsMax: 0,
        count: 0,
        correctCount: 0,
        percent: 0,
      };
      entry.points += item.points;
      entry.pointsMax += item.pointsMax;
      entry.count += item.count;
      entry.correctCount += item.correctCount;
      map.set(item.key, entry);
    }
  }
  return [...map.values()].map((entry) => ({
    ...entry,
    percent: entry.pointsMax > 0 ? Math.round((entry.points / entry.pointsMax) * 1000) / 10 : 0,
  }));
}

type Props = {
  scope: number[] | null;
  basePath: string;
  showItemAnalysis?: boolean;
};

/** How many recent results per subject the estimated TKA score averages. */
const ESTIMATE_WINDOW = 3;

export function AnalyticsView({ scope, basePath, showItemAnalysis = true }: Props) {
  closeExpiredFor(scope);

  // "/admin/hasil" -> "/admin/penugasan/baru", "/wali/hasil" -> "/wali/penugasan/baru"
  const newAssignmentHref = basePath.replace(/\/hasil$/, '/penugasan/baru');

  const daftarMurid =
    scope !== null && scope.length === 0
      ? []
      : db
          .select({ id: users.id, nama: users.nama })
          .from(users)
          .where(
            and(
              eq(users.aktif, true),
              eq(users.role, 'student'),
              scope === null ? undefined : inArray(users.id, scope),
            ),
          )
          .orderBy(users.nama)
          .all();

  const perMurid = daftarMurid.map((murid) => {
    const selesai = db
      .select()
      .from(attempts)
      .where(and(eq(attempts.userId, murid.id), eq(attempts.status, 'selesai')))
      .orderBy(attempts.id)
      .all();

    const breakdowns = selesai.map((attempt) => parseBreakdown(attempt.scoreBreakdownJson));
    const byDomain = gabung(breakdowns.map((b) => b.byDomain));
    const byCompetency = gabung(breakdowns.map((b) => b.byCompetency));

    const tren = selesai.map((attempt) => attempt.scorePercent ?? 0);
    const rata = tren.length > 0 ? tren.reduce((a, b) => a + b, 0) / tren.length : null;

    // Per subject, oldest first: the trend line and a rough "if the TKA were
    // today" estimate from the latest few results.
    const perMapel = SUBJECTS.map((subject) => {
      const titik = breakdowns
        .map((b, i) => ({ item: b.bySubject.find((x) => x.key === subject), i }))
        .filter((x): x is { item: Breakdown; i: number } => Boolean(x.item))
        .map(({ item, i }) => ({ nilai: item.percent, tanggal: selesai[i].submittedAt }));
      const terakhir = titik.slice(-ESTIMATE_WINDOW);
      const perkiraan = terakhir.length
        ? terakhir.reduce((sum, t) => sum + t.nilai, 0) / terakhir.length
        : null;
      return { subject, titik, perkiraan };
    }).filter((m) => m.titik.length > 0);

    const sisaBank = SUBJECTS.map((subject) => ({
      subject,
      sisa: countAvailable(sqlite, murid.id, subject),
    }));

    const cukupData = byDomain.filter((item) => item.count >= 3);
    const terlemah = [...cukupData].sort((a, b) => a.percent - b.percent).slice(0, 3);
    const terkuat = [...cukupData].sort((a, b) => b.percent - a.percent).slice(0, 3);

    const latihHref =
      terlemah.length > 0
        ? `${newAssignmentHref}?untuk=${murid.id}&latih=${terlemah.map((t) => t.key).join(',')}`
        : null;

    return {
      murid,
      selesai,
      rata,
      perMapel,
      byDomain,
      byCompetency,
      sisaBank,
      terlemah,
      terkuat,
      latihHref,
    };
  });

  // Item analysis: how often each question is answered correctly.
  const butir = db
    .select({
      questionId: sql<string>`aa.question_id`,
      dipakai: sql<number>`COUNT(*)`,
      benar: sql<number>`SUM(CASE WHEN aa.is_correct = 1 THEN 1 ELSE 0 END)`,
      subject: questions.subject,
      domain: questions.contentDomain,
      difficulty: questions.difficulty,
      stem: questions.stemMd,
    })
    .from(sql`attempt_answers aa`)
    .innerJoin(questions, sql`${questions.id} = aa.question_id`)
    .where(sql`aa.is_correct IS NOT NULL`)
    .groupBy(sql`aa.question_id`)
    .having(sql`COUNT(*) >= 2`)
    .all();

  const tersulit = [...butir]
    .map((row) => ({ ...row, rasio: Number(row.benar) / Number(row.dipakai) }))
    .sort((a, b) => a.rasio - b.rasio)
    .slice(0, 8);

  const belumPernah =
    db
      .select({ n: sql<number>`COUNT(*)` })
      .from(questions)
      .where(
        sql`${questions.aktif} = 1 AND NOT EXISTS (SELECT 1 FROM attempt_answers aa WHERE aa.question_id = ${questions.id})`,
      )
      .get()?.n ?? 0;

  return (
    <div>
      <h1 className="text-2xl font-bold">Analitik</h1>
      <p className="mt-1 text-sm text-muted">
        Kekuatan dan kelemahan tiap murid, serta butir soal yang paling sulit.
      </p>

      <h2 className="mt-7 mb-3 text-lg font-bold">Per murid</h2>
      {perMurid.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface p-8 text-center text-muted">
          Belum ada murid.
        </p>
      ) : (
        <ul className="space-y-4">
          {perMurid.map((data) => (
            <li key={data.murid.id} className="rounded-2xl border border-line bg-surface p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-bold">{data.murid.nama}</h3>
                <p className="text-sm text-muted">
                  {data.selesai.length} tugas selesai
                  {data.rata !== null ? (
                    <>
                      {' · rata-rata '}
                      <span className={`font-semibold ${scoreTone(data.rata)}`}>
                        {displayScore(Math.round(data.rata * 10) / 10)}
                      </span>
                    </>
                  ) : null}
                </p>
              </div>

              {data.perMapel.length > 0 ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  {data.perMapel.map((mapel) => (
                    <div key={mapel.subject} className="rounded-xl bg-surface2 p-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-xs font-semibold">{SUBJECT_LABEL[mapel.subject]}</p>
                        {mapel.perkiraan !== null ? (
                          <p
                            className="text-xs text-muted"
                            title={`Rata-rata ${Math.min(ESTIMATE_WINDOW, mapel.titik.length)} hasil terakhir`}
                          >
                            perkiraan{' '}
                            <span className={`font-bold ${scoreTone(mapel.perkiraan)}`}>
                              {displayScore(Math.round(mapel.perkiraan * 10) / 10)}
                            </span>
                          </p>
                        ) : null}
                      </div>
                      {mapel.titik.length > 1 ? (
                        <div
                          className="mt-2 flex h-12 items-end gap-1"
                          role="img"
                          aria-label={`Tren nilai ${SUBJECT_LABEL[mapel.subject]}: ${mapel.titik
                            .map((t) => displayScore(t.nilai))
                            .join(', ')}`}
                        >
                          {mapel.titik.map((t, i) => (
                            <div
                              key={i}
                              className="flex-1 rounded-t bg-brand/70"
                              style={{ height: `${Math.max(t.nilai, 3)}%` }}
                              title={`${formatDate(t.tanggal)}: ${displayScore(t.nilai)}`}
                            />
                          ))}
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-muted">Satu hasil; tren muncul setelah dua.</p>
                      )}
                    </div>
                  ))}
                </div>
              ) : null}

              {data.terlemah.length > 0 ? (
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                        Perlu diperkuat
                      </p>
                      {data.latihHref ? (
                        <Link
                          href={data.latihHref}
                          className="text-xs font-semibold text-brand underline underline-offset-4"
                        >
                          Latih bagian ini
                        </Link>
                      ) : null}
                    </div>
                    <ul className="space-y-1.5 text-sm">
                      {data.terlemah.map((item) => {
                        const [subject, key] = item.key.split(':') as [Subject, string];
                        return (
                          <li key={item.key} className="flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate">
                              {domainLabel(subject, key)}
                              <span className="text-muted"> · {SUBJECT_LABEL[subject]}</span>
                            </span>
                            <span className={`shrink-0 font-semibold ${scoreTone(item.percent)}`}>
                              {Math.round(item.percent)}%
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                      Sudah kuat
                    </p>
                    <ul className="space-y-1.5 text-sm">
                      {data.terkuat.map((item) => {
                        const [subject, key] = item.key.split(':') as [Subject, string];
                        return (
                          <li key={item.key} className="flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate">
                              {domainLabel(subject, key)}
                              <span className="text-muted"> · {SUBJECT_LABEL[subject]}</span>
                            </span>
                            <span className={`shrink-0 font-semibold ${scoreTone(item.percent)}`}>
                              {Math.round(item.percent)}%
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted">
                  Belum cukup data untuk menyimpulkan kekuatan dan kelemahan.
                </p>
              )}

              {data.byCompetency.length > 0 ? (
                <div className="mt-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                    Per kemampuan
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {data.byCompetency.map((item) => {
                      const [subject, key] = item.key.split(':') as [Subject, string];
                      return (
                        <span
                          key={item.key}
                          className="rounded-lg bg-surface2 px-2.5 py-1 text-xs"
                          title={SUBJECT_LABEL[subject]}
                        >
                          {competencyLabel(subject, key)}{' '}
                          <span className={`font-semibold ${scoreTone(item.percent)}`}>
                            {Math.round(item.percent)}%
                          </span>
                        </span>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                <span className="text-xs text-muted">Sisa soal baru di bank:</span>
                {data.sisaBank.map((item) => {
                  const paket = Math.floor(item.sisa / BLUEPRINT[item.subject].itemsInRealExam);
                  return (
                    <span
                      key={item.subject}
                      className={`rounded-md px-2 py-1 text-xs font-medium ${
                        paket === 0
                          ? 'bg-badsoft text-bad'
                          : paket < 2
                            ? 'bg-warnsoft text-warn'
                            : 'bg-surface2 text-muted'
                      }`}
                      title={`Cukup untuk ${paket} paket TKA penuh tanpa soal berulang`}
                    >
                      {SUBJECT_LABEL[item.subject]}: {item.sisa} (±{paket} paket)
                    </span>
                  );
                })}
                <Link
                  href={`${basePath}?murid=${data.murid.id}`}
                  className="ml-auto text-xs font-medium text-brand underline underline-offset-4"
                >
                  Lihat hasilnya
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}

      {showItemAnalysis ? (
        <>
      <h2 className="mt-8 mb-3 text-lg font-bold">Analisis butir soal</h2>
      <p className="mb-3 text-sm text-muted">
        {belumPernah} butir aktif belum pernah dikerjakan siapa pun. Daftar di bawah hanya memuat
        butir yang sudah dikerjakan minimal dua kali.
      </p>

      {tersulit.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface p-8 text-center text-muted">
          Belum cukup data untuk analisis butir.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-muted">
                <th className="p-3 font-semibold">Butir</th>
                <th className="p-3 font-semibold">Materi</th>
                <th className="p-3 font-semibold">Label</th>
                <th className="p-3 text-right font-semibold">Dikerjakan</th>
                <th className="p-3 text-right font-semibold">Benar</th>
              </tr>
            </thead>
            <tbody>
              {tersulit.map((row) => {
                const subject = row.subject as Subject;
                const persen = Math.round(row.rasio * 100);
                const labelSesuai =
                  (row.difficulty === 'mudah' && persen < 50) ||
                  (row.difficulty === 'sulit' && persen > 85);
                return (
                  <tr key={row.questionId} className="border-b border-line last:border-0">
                    <td className="max-w-[18rem] p-3">
                      <span className="text-xs text-muted">{row.questionId}</span>
                      <p className="line-clamp-2 text-sm">{row.stem.replace(/\$[^$]*\$/g, '…')}</p>
                    </td>
                    <td className="p-3 text-xs text-muted">
                      {SUBJECT_LABEL[subject]}
                      <br />
                      {domainLabel(subject, row.domain)}
                    </td>
                    <td className="p-3">
                      <span
                        className={`rounded-md px-2 py-1 text-xs font-medium ${
                          labelSesuai ? 'bg-warnsoft text-warn' : 'bg-surface2 text-muted'
                        }`}
                        title={
                          labelSesuai
                            ? 'Tingkat kesulitan yang ditulis di bank tampaknya tidak cocok dengan hasil nyata'
                            : undefined
                        }
                      >
                        {row.difficulty}
                      </span>
                    </td>
                    <td className="p-3 text-right tabular-nums">{Number(row.dipakai)}</td>
                    <td className="p-3 text-right">
                      <span className={`font-semibold ${scoreTone(persen)}`}>{persen}%</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-muted">
        Target bank soal:{' '}
        {SUBJECTS.map((subject) => `${SUBJECT_LABEL[subject]} ${BLUEPRINT[subject].bankTarget}`).join(
          ' · ',
        )}
        .
      </p>
        </>
      ) : null}
    </div>
  );
}
