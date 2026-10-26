import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { and, count, desc, eq, inArray, isNull, like, or, type SQL } from 'drizzle-orm';
import { db } from '@/db/client';
import { questionReports, questions, stimuli, users } from '@/db/schema';
import { Figure } from '@/components/Figure';
import { buildRunnerQuestion } from '@/lib/attempt';
import {
  BLUEPRINT,
  DIFFICULTY_LABEL,
  QUESTION_TYPE_LABEL,
  SUBJECTS,
  SUBJECT_LABEL,
  domainLabel,
  isSubject,
  type Difficulty,
  type QuestionType,
  type Subject,
} from '@/domain/blueprint';
import { SUBJECT_BADGE } from '@/lib/ui';
import { actionUser, requireUser } from '@/lib/auth';
import { resolveReport } from '@/actions/report';
import { ActionForm } from '@/components/ActionForm';
import { formatDateTime } from '@/lib/ui';

export const dynamic = 'force-dynamic';

const PER_HALAMAN = 20;

export default async function BankSoalPage({
  searchParams,
}: {
  searchParams: Promise<{ mapel?: string; materi?: string; cari?: string; hal?: string }>;
}) {
  await requireUser('admin');
  const { mapel, materi, cari, hal } = await searchParams;
  const halaman = Math.max(1, Number(hal ?? '1') || 1);

  const filters: SQL[] = [];
  if (mapel && isSubject(mapel)) filters.push(eq(questions.subject, mapel));
  if (materi) filters.push(eq(questions.contentDomain, materi));
  if (cari) {
    const pola = `%${cari}%`;
    const cocok = or(like(questions.stemMd, pola), like(questions.id, pola));
    if (cocok) filters.push(cocok);
  }
  const where = filters.length > 0 ? and(...filters) : undefined;

  const total = db.select({ n: count() }).from(questions).where(where).get()?.n ?? 0;

  const rows = db
    .select()
    .from(questions)
    .where(where)
    .orderBy(questions.id)
    .limit(PER_HALAMAN)
    .offset((halaman - 1) * PER_HALAMAN)
    .all();

  const stimulusIds = [...new Set(rows.map((r) => r.stimulusId).filter((id): id is string => !!id))];
  const stimulusRows = stimulusIds.length
    ? db.select().from(stimuli).where(inArray(stimuli.id, stimulusIds)).all()
    : [];
  const stimulusById = new Map(stimulusRows.map((row) => [row.id, row]));

  const ringkasan = SUBJECTS.map((subject) => ({
    subject,
    label: SUBJECT_LABEL[subject],
    target: BLUEPRINT[subject].bankTarget,
    jumlah:
      db
        .select({ n: count() })
        .from(questions)
        .where(
          and(
            eq(questions.subject, subject),
            eq(questions.aktif, true),
            eq(questions.retiredByAdmin, false),
          ),
        )
        .get()?.n ?? 0,
    domains: BLUEPRINT[subject].domains.map((domain) => ({
      ...domain,
      jumlah:
        db
          .select({ n: count() })
          .from(questions)
          .where(
            and(
              eq(questions.subject, subject),
              eq(questions.contentDomain, domain.key),
              eq(questions.aktif, true),
              eq(questions.retiredByAdmin, false),
            ),
          )
          .get()?.n ?? 0,
    })),
  }));

  // Withdrawing an item writes retired_by_admin, a column bank:sync never
  // touches, so the next deploy cannot quietly bring a bad item back.
  async function ubahAktif(formData: FormData) {
    'use server';
    // Re-checked inside the action: the page guard above does not protect it.
    const me = await actionUser();
    if (!me || me.role !== 'admin') return;

    const id = String(formData.get('id') ?? '').slice(0, 64);
    const tarik = String(formData.get('tarik')) === '1';
    if (!id) return;

    db.update(questions).set({ retiredByAdmin: tarik }).where(eq(questions.id, id)).run();
    revalidatePath('/admin/bank');
  }

  const laporan = db
    .select({
      id: questionReports.id,
      questionId: questionReports.questionId,
      pesan: questionReports.pesan,
      createdAt: questionReports.createdAt,
      pelapor: users.nama,
    })
    .from(questionReports)
    .leftJoin(users, eq(users.id, questionReports.userId))
    .where(isNull(questionReports.resolvedAt))
    .orderBy(desc(questionReports.id))
    .limit(50)
    .all();

  const totalHalaman = Math.max(1, Math.ceil(total / PER_HALAMAN));
  const queryDasar = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const gabungan = { mapel, materi, cari, ...patch };
    for (const [key, value] of Object.entries(gabungan)) {
      if (value) params.set(key, value);
    }
    const query = params.toString();
    return query ? `/admin/bank?${query}` : '/admin/bank';
  };

  const mapelAktif = mapel && isSubject(mapel) ? mapel : null;

  return (
    <div>
      <h1 className="text-2xl font-bold">Bank soal</h1>
      <p className="mt-1 text-sm text-muted">
        Sumber kebenarannya ada di <code>content/bank/*.json</code>. Tambah file batch baru di sana,
        lalu jalankan <code>npm run bank:sync</code>.
      </p>

      {laporan.length > 0 ? (
        <section className="mt-5 rounded-2xl border border-warn bg-warnsoft/40 p-4 sm:p-5">
          <h2 className="font-semibold">Laporan soal yang belum ditinjau ({laporan.length})</h2>
          <ul className="mt-3 space-y-2">
            {laporan.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-start gap-3 rounded-xl bg-surface p-3 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    href={queryDasar({ mapel: undefined, materi: undefined, cari: item.questionId, hal: undefined })}
                    className="font-mono text-xs text-brand underline underline-offset-2 break-words"
                  >
                    {item.questionId}
                  </Link>
                  <span className="text-xs text-muted">
                    {' '}
                    &middot; {item.pelapor ?? 'akun terhapus'} &middot; {formatDateTime(item.createdAt)}
                  </span>
                  <p className="mt-1 whitespace-pre-wrap break-words">{item.pesan}</p>
                </div>
                <ActionForm action={resolveReport}>
                  <input type="hidden" name="id" value={item.id} />
                  <button
                    type="submit"
                    className="min-h-9 rounded-lg border border-line px-3 py-2 text-xs font-medium transition hover:border-brand"
                  >
                    Tandai selesai
                  </button>
                </ActionForm>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">
            Perbaiki di <code>content/bank/*.json</code> lalu jalankan <code>npm run bank:sync</code>,
            atau tarik soalnya dengan tombol di bawah. Nilai yang sudah diberikan tidak berubah: kunci
            dibekukan di tiap pengerjaan.
          </p>
        </section>
      ) : null}

      <section className="mt-5 grid gap-3 sm:grid-cols-3">
        {ringkasan.map((item) => (
          <div key={item.subject} className="rounded-2xl border border-line bg-surface p-4">
            <div className="flex items-baseline justify-between">
              <p className="font-semibold">{item.label}</p>
              <p className="text-sm tabular-nums text-muted">
                {item.jumlah}/{item.target}
              </p>
            </div>
            <ul className="mt-3 space-y-1 text-xs">
              {item.domains.map((domain) => (
                <li key={domain.key} className="flex justify-between gap-2">
                  <Link
                    href={queryDasar({ mapel: item.subject, materi: domain.key, hal: undefined })}
                    className="min-w-0 truncate text-muted underline-offset-2 hover:text-brand hover:underline"
                  >
                    {domain.label}
                  </Link>
                  <span
                    className={`shrink-0 tabular-nums ${domain.jumlah >= domain.target ? 'text-ok' : 'text-muted'}`}
                  >
                    {domain.jumlah}/{domain.target}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <form method="get" className="mt-6 flex flex-wrap gap-2 rounded-2xl border border-line bg-surface p-4">
        <select
          name="mapel"
          defaultValue={mapel ?? ''}
          className="w-full min-w-0 rounded-xl border border-line bg-surface2 px-3 py-2.5 sm:w-auto"
          aria-label="Saring mata pelajaran"
        >
          <option value="">Semua mapel</option>
          {SUBJECTS.map((subject) => (
            <option key={subject} value={subject}>
              {SUBJECT_LABEL[subject]}
            </option>
          ))}
        </select>

        {mapelAktif ? (
          <select
            name="materi"
            defaultValue={materi ?? ''}
            className="w-full min-w-0 rounded-xl border border-line bg-surface2 px-3 py-2.5 sm:w-auto"
            aria-label="Saring materi"
          >
            <option value="">Semua materi</option>
            {BLUEPRINT[mapelAktif].domains.map((domain) => (
              <option key={domain.key} value={domain.key}>
                {domain.label}
              </option>
            ))}
          </select>
        ) : null}

        <input
          name="cari"
          defaultValue={cari ?? ''}
          placeholder="Cari teks soal atau id…"
          className="min-w-0 flex-1 basis-full rounded-xl border border-line bg-surface2 px-4 py-2.5 sm:basis-auto"
        />
        <button type="submit" className="rounded-xl bg-brand px-5 py-2.5 font-semibold text-white">
          Terapkan
        </button>
        <Link
          href="/admin/bank"
          className="rounded-xl border border-line px-4 py-2.5 text-sm font-medium"
        >
          Reset
        </Link>
      </form>

      <p className="mt-4 text-sm text-muted">
        {total} butir cocok &middot; halaman {halaman} dari {totalHalaman}
      </p>

      <ul className="mt-3 space-y-3">
        {rows.map((row) => {
          const view = buildRunnerQuestion(
            row,
            row.stimulusId ? stimulusById.get(row.stimulusId) ?? null : null,
            undefined,
          );
          const subject = row.subject as Subject;

          return (
            <li
              key={row.id}
              className={`rounded-2xl border border-line bg-surface p-4 sm:p-5 ${
                row.aktif && !row.retiredByAdmin ? '' : 'opacity-60'
              }`}
            >
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className={`rounded-md px-2 py-1 text-xs font-semibold ${SUBJECT_BADGE[subject]}`}>
                  {SUBJECT_LABEL[subject]}
                </span>
                <span className="rounded-md bg-surface2 px-2 py-1 text-xs text-muted">
                  {domainLabel(subject, row.contentDomain)}
                </span>
                <span className="rounded-md bg-surface2 px-2 py-1 text-xs text-muted">
                  {QUESTION_TYPE_LABEL[row.type as QuestionType]}
                </span>
                <span className="rounded-md bg-surface2 px-2 py-1 text-xs text-muted">
                  {DIFFICULTY_LABEL[row.difficulty as Difficulty]}
                </span>
                <code className="text-xs text-muted break-words">{row.id}</code>

                {!row.aktif ? (
                  <span className="rounded-md bg-surface2 px-2 py-1 text-xs text-muted">
                    tidak ada lagi di berkas bank
                  </span>
                ) : null}
                <form action={ubahAktif} className="ml-auto">
                  <input type="hidden" name="id" value={row.id} />
                  <input type="hidden" name="tarik" value={row.retiredByAdmin ? '0' : '1'} />
                  <button
                    type="submit"
                    className="min-h-9 rounded-lg border border-line px-3 py-2 text-xs font-medium transition hover:border-brand"
                  >
                    {row.retiredByAdmin ? 'Pakai lagi' : 'Tarik dari undian'}
                  </button>
                </form>
              </div>

              {view.stimulus ? (
                <details className="mb-3 rounded-xl bg-surface2 p-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    Teks bacaan: {view.stimulus.title}
                  </summary>
                  <div
                    className="prose-soal mt-2 text-sm"
                    dangerouslySetInnerHTML={{ __html: view.stimulus.bodyHtml }}
                  />
                </details>
              ) : null}

              <div
                className="prose-soal text-sm"
                dangerouslySetInnerHTML={{ __html: view.stemHtml }}
              />

              {view.figure ? (
                <Figure
                  figure={view.figure.figure}
                  safeSvg={view.figure.safeSvg}
                  className="mt-3 max-w-sm"
                />
              ) : null}

              {view.choices ? (
                <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
                  {view.choices.map((choice, i) => (
                    <li key={choice.id} className="flex items-start gap-2 text-sm">
                      <span className="mt-0.5 font-semibold text-muted">
                        {String.fromCharCode(65 + i)}.
                      </span>
                      <span className="min-w-0">
                        {choice.figure ? (
                          <Figure
                            figure={choice.figure.figure}
                            safeSvg={choice.figure.safeSvg}
                            className="mb-1 max-w-[9rem]"
                          />
                        ) : null}
                        <span
                          className="prose-soal"
                          dangerouslySetInnerHTML={{ __html: choice.html }}
                        />
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {view.statements ? (
                <ul className="mt-3 space-y-1 text-sm">
                  {view.statements.map((statement) => (
                    <li key={statement.id} className="flex gap-2">
                      <span className="text-muted">•</span>
                      <span dangerouslySetInnerHTML={{ __html: statement.html }} />
                    </li>
                  ))}
                </ul>
              ) : null}

              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-medium text-brand">
                  Kunci & pembahasan
                </summary>
                <p className="mt-2 font-mono text-xs text-muted break-words">{row.answerJson}</p>
                <p className="mt-2 text-sm">{row.explanationMd}</p>
              </details>
            </li>
          );
        })}
      </ul>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface p-10 text-center text-muted">
          Tidak ada butir yang cocok dengan penyaringan ini.
        </p>
      ) : null}

      {totalHalaman > 1 ? (
        <nav className="mt-5 flex items-center justify-between">
          <Link
            href={queryDasar({ hal: String(Math.max(1, halaman - 1)) })}
            aria-disabled={halaman === 1}
            className={`rounded-lg border border-line px-4 py-2 text-sm ${
              halaman === 1 ? 'pointer-events-none opacity-40' : ''
            }`}
          >
            ← Sebelumnya
          </Link>
          <span className="text-sm text-muted">
            {halaman} / {totalHalaman}
          </span>
          <Link
            href={queryDasar({ hal: String(Math.min(totalHalaman, halaman + 1)) })}
            aria-disabled={halaman === totalHalaman}
            className={`rounded-lg border border-line px-4 py-2 text-sm ${
              halaman === totalHalaman ? 'pointer-events-none opacity-40' : ''
            }`}
          >
            Berikutnya →
          </Link>
        </nav>
      ) : null}
    </div>
  );
}
