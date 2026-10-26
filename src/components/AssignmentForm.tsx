'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { checkAvailability, createAssignment, type SectionInput } from '@/actions/assignment';
import {
  DIFFICULTIES,
  DIFFICULTY_LABEL,
  QUESTION_TYPES,
  QUESTION_TYPE_LABEL,
  SUBJECTS,
  SUBJECT_LABEL,
  type Difficulty,
  type QuestionType,
  type Subject,
} from '@/domain/blueprint';
import { humanizeDuration, proportionalSeconds, resolveDurationSeconds, type TimingMode } from '@/domain/timing';

type BlueprintInfo = {
  subject: Subject;
  label: string;
  provisional: boolean;
  domains: { key: string; label: string }[];
  competencies: { key: string; label: string }[];
  tersedia: number;
};

type UserOption = { id: number; nama: string };

type Row = {
  subject: Subject;
  jumlahSoal: number;
  domains: string[];
  competencies: string[];
  difficulties: string[];
  types: string[];
  terbuka: boolean;
};

type Availability = Awaited<ReturnType<typeof checkAvailability>>;

/** Pre-filled values, e.g. a remedial practice built from a child's weakest strands. */
export type AssignmentPreset = {
  judul?: string;
  userIds?: number[];
  sections?: { subject: Subject; jumlahSoal: number; domains?: string[] }[];
};

const PRESETS = [
  { label: 'TKA penuh (30 tiap mapel)', counts: { bahasa_indonesia: 30, matematika: 30, ipas: 30 } },
  { label: 'Satu paket 30 soal', counts: { bahasa_indonesia: 10, matematika: 10, ipas: 10 } },
  { label: 'Latihan singkat 15 soal', counts: { bahasa_indonesia: 5, matematika: 5, ipas: 5 } },
] as const;

export function AssignmentForm({
  blueprint,
  users,
  doneHref = '/admin/penugasan',
  preset,
}: {
  blueprint: BlueprintInfo[];
  users: UserOption[];
  /** Where to go once the assignment exists -- differs for admin and parent. */
  doneHref?: string;
  preset?: AssignmentPreset;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [judul, setJudul] = useState(preset?.judul ?? '');
  const [rows, setRows] = useState<Row[]>(() =>
    SUBJECTS.map((subject) => {
      const given = preset?.sections?.find((section) => section.subject === subject);
      return {
        subject,
        jumlahSoal: given?.jumlahSoal ?? 0,
        domains: given?.domains ?? [],
        competencies: [],
        difficulties: [],
        types: [],
        terbuka: Boolean(given?.domains?.length),
      };
    }),
  );
  const [terpilih, setTerpilih] = useState<number[]>(() =>
    (preset?.userIds ?? []).filter((id) => users.some((u) => u.id === id)),
  );
  // On by default: a practice paper should look like the real one.
  const [ikutKisi, setIkutKisi] = useState(!preset?.sections?.some((s) => s.domains?.length));
  const [tenggat, setTenggat] = useState('');
  const [timingMode, setTimingMode] = useState<TimingMode>('proporsional');
  const [customMinutes, setCustomMinutes] = useState(60);
  const [allowRepeat, setAllowRepeat] = useState(false);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [error, setError] = useState<string | null>(null);

  const totalSoal = rows.reduce((sum, row) => sum + row.jumlahSoal, 0);
  const durasi = resolveDurationSeconds(timingMode, totalSoal, customMinutes);

  const infoBySubject = useMemo(
    () => new Map(blueprint.map((item) => [item.subject, item])),
    [blueprint],
  );

  const patch = (subject: Subject, ubah: Partial<Row>) =>
    setRows((prev) => prev.map((row) => (row.subject === subject ? { ...row, ...ubah } : row)));

  const toggleIn = (list: string[], value: string): string[] =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

  const move = (from: number, to: number) => {
    if (to < 0 || to >= rows.length) return;
    setRows((prev) => {
      const next = prev.slice();
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  };

  const toSectionInputs = (): SectionInput[] =>
    rows
      .filter((row) => row.jumlahSoal > 0)
      .map((row) => {
        const adaFilter =
          row.domains.length + row.competencies.length + row.difficulties.length + row.types.length >
          0;

        return {
          subject: row.subject,
          jumlahSoal: row.jumlahSoal,
          blueprint: ikutKisi,
          filters: adaFilter
            ? {
                domains: row.domains.length ? row.domains : undefined,
                competencies: row.competencies.length ? row.competencies : undefined,
                difficulties: row.difficulties.length
                  ? (row.difficulties as Difficulty[])
                  : undefined,
                types: row.types.length ? (row.types as QuestionType[]) : undefined,
              }
            : null,
        };
      });

  const lihatKetersediaan = () => {
    setError(null);
    startTransition(async () => {
      setAvailability(await checkAvailability(toSectionInputs(), terpilih));
    });
  };

  const simpan = () => {
    setError(null);
    startTransition(async () => {
      const result = await createAssignment({
        judul: judul.trim() || `Latihan ${totalSoal} soal`,
        sections: toSectionInputs(),
        userIds: terpilih,
        timingMode,
        customMinutes: timingMode === 'custom' ? customMinutes : null,
        allowRepeat,
        dueDate: tenggat || null,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(doneHref);
      router.refresh();
    });
  };

  const kurang = availability?.some((baris) =>
    baris.perSection.some((section) => section.tersedia < section.diminta),
  );

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-line bg-surface p-5">
        <label htmlFor="judul" className="mb-1.5 block text-sm font-semibold">
          Judul penugasan
        </label>
        <input
          id="judul"
          value={judul}
          onChange={(event) => setJudul(event.target.value)}
          placeholder="Contoh: Latihan TKA pekan 1"
          className="w-full rounded-xl border border-line bg-surface2 px-4 py-2.5 outline-none focus:border-brand"
        />
      </section>

      <section className="rounded-2xl border border-line bg-surface p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Komposisi soal per mata pelajaran</h2>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() =>
                  setRows((prev) =>
                    prev.map((row) => ({
                      ...row,
                      jumlahSoal: preset.counts[row.subject] ?? 0,
                    })),
                  )
                }
                className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-muted transition hover:border-brand hover:text-brand"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <ul className="space-y-3">
          {rows.map((row, i) => {
            const info = infoBySubject.get(row.subject);
            return (
              <li key={row.subject} className="rounded-xl border border-line bg-surface2 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex flex-col">
                    <button
                      type="button"
                      onClick={() => move(i, i - 1)}
                      disabled={i === 0}
                      aria-label="Pindah ke atas"
                      className="text-xs text-muted disabled:opacity-30"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      onClick={() => move(i, i + 1)}
                      disabled={i === rows.length - 1}
                      aria-label="Pindah ke bawah"
                      className="text-xs text-muted disabled:opacity-30"
                    >
                      ▼
                    </button>
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      {SUBJECT_LABEL[row.subject]}
                      {info?.provisional ? (
                        <span
                          className="ml-2 rounded bg-warnsoft px-1.5 py-0.5 text-[11px] font-medium text-warn"
                          title="Kisi-kisi resmi belum terbit; blueprint disusun dari CP Kurikulum Merdeka kelas 4-6"
                        >
                          provisional
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted">{info?.tersedia ?? 0} soal aktif di bank</p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => patch(row.subject, { jumlahSoal: Math.max(0, row.jumlahSoal - 5) })}
                      className="h-9 w-9 rounded-lg border border-line font-bold"
                      aria-label={`Kurangi soal ${SUBJECT_LABEL[row.subject]}`}
                    >
                      −
                    </button>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={row.jumlahSoal}
                      onChange={(event) =>
                        patch(row.subject, {
                          jumlahSoal: Math.max(0, Math.min(100, Number(event.target.value) || 0)),
                        })
                      }
                      className="w-16 rounded-lg border border-line bg-surface px-2 py-2 text-center font-semibold"
                      aria-label={`Jumlah soal ${SUBJECT_LABEL[row.subject]}`}
                    />
                    <button
                      type="button"
                      onClick={() => patch(row.subject, { jumlahSoal: Math.min(100, row.jumlahSoal + 5) })}
                      className="h-9 w-9 rounded-lg border border-line font-bold"
                      aria-label={`Tambah soal ${SUBJECT_LABEL[row.subject]}`}
                    >
                      +
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => patch(row.subject, { terbuka: !row.terbuka })}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-brand"
                  >
                    {row.terbuka ? 'Tutup filter' : 'Filter'}
                  </button>
                </div>

                {row.terbuka && info ? (
                  <div className="mt-4 grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
                    <FilterGroup
                      title="Materi"
                      options={info.domains.map((d) => ({ value: d.key, label: d.label }))}
                      selected={row.domains}
                      onToggle={(value) => patch(row.subject, { domains: toggleIn(row.domains, value) })}
                    />
                    <FilterGroup
                      title="Kemampuan"
                      options={info.competencies.map((c) => ({ value: c.key, label: c.label }))}
                      selected={row.competencies}
                      onToggle={(value) =>
                        patch(row.subject, { competencies: toggleIn(row.competencies, value) })
                      }
                    />
                    <FilterGroup
                      title="Bentuk soal"
                      options={QUESTION_TYPES.map((t) => ({ value: t, label: QUESTION_TYPE_LABEL[t] }))}
                      selected={row.types}
                      onToggle={(value) => patch(row.subject, { types: toggleIn(row.types, value) })}
                    />
                    <FilterGroup
                      title="Tingkat kesulitan"
                      options={DIFFICULTIES.map((d) => ({ value: d, label: DIFFICULTY_LABEL[d] }))}
                      selected={row.difficulties}
                      onToggle={(value) =>
                        patch(row.subject, { difficulties: toggleIn(row.difficulties, value) })
                      }
                    />
                    <p className="text-xs text-muted sm:col-span-2">
                      Tanpa centang berarti seluruh pilihan boleh terundi.
                    </p>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>

        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3">
          <input
            type="checkbox"
            checked={ikutKisi}
            onChange={(event) => setIkutKisi(event.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[var(--brand)]"
          />
          <span className="text-sm">
            <span className="font-medium">Komposisi seperti TKA asli</span>
            <span className="block text-muted">
              Materi dibagi sesuai kisi-kisi dan tingkat kesulitan 30% mudah, 50% sedang, 20% sulit.
              Matikan untuk undian acak sepenuhnya.
            </span>
          </span>
        </label>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-brandsoft px-4 py-3">
          <span className="text-sm font-semibold text-brand">Total {totalSoal} soal</span>
          <span className="text-sm text-brand">
            Waktu proporsional: {humanizeDuration(proportionalSeconds(totalSoal))}
          </span>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Murid yang menerima</h2>
          <button
            type="button"
            onClick={() => setTerpilih(terpilih.length === users.length ? [] : users.map((u) => u.id))}
            className="text-sm font-medium text-brand"
          >
            {terpilih.length === users.length ? 'Kosongkan' : 'Pilih semua'}
          </button>
        </div>

        {users.length === 0 ? (
          <p className="text-sm text-muted">Belum ada murid. Tambahkan lebih dulu di menu Murid.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {users.map((murid) => {
              const aktif = terpilih.includes(murid.id);
              return (
                <li key={murid.id}>
                  <button
                    type="button"
                    onClick={() =>
                      setTerpilih((prev) =>
                        prev.includes(murid.id)
                          ? prev.filter((id) => id !== murid.id)
                          : [...prev, murid.id],
                      )
                    }
                    aria-pressed={aktif}
                    className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${
                      aktif ? 'border-brand bg-brandsoft' : 'border-line hover:border-brand/60'
                    }`}
                  >
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded border text-xs font-bold ${
                        aktif ? 'border-brand bg-brand text-white' : 'border-line'
                      }`}
                    >
                      {aktif ? '✓' : ''}
                    </span>
                    <span className="font-medium">{murid.nama}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-line bg-surface p-5">
        <h2 className="mb-1 font-semibold">Batas waktu</h2>
        <p className="mb-4 text-sm text-muted">
          Jatah waktu berlaku untuk keseluruhan penugasan, bukan per soal maupun per mapel. Murid
          bebas membagi waktunya sendiri.
        </p>

        <div className="space-y-2">
          {(
            [
              ['proporsional', `Proporsional TKA — ${humanizeDuration(proportionalSeconds(totalSoal))} untuk ${totalSoal} soal`],
              ['custom', 'Atur sendiri'],
              ['tanpa_batas', 'Tanpa batas waktu'],
            ] as [TimingMode, string][]
          ).map(([mode, label]) => (
            <label
              key={mode}
              className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition ${
                timingMode === mode ? 'border-brand bg-brandsoft' : 'border-line'
              }`}
            >
              <input
                type="radio"
                name="timing"
                checked={timingMode === mode}
                onChange={() => setTimingMode(mode)}
                className="h-4 w-4 accent-[var(--brand)]"
              />
              <span className="text-sm font-medium">{label}</span>
              {mode === 'custom' && timingMode === 'custom' ? (
                <span className="ml-auto flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={600}
                    value={customMinutes}
                    onChange={(event) => setCustomMinutes(Number(event.target.value))}
                    className="w-20 rounded-lg border border-line bg-surface2 px-2 py-1.5 text-center"
                    aria-label="Menit"
                  />
                  <span className="text-sm text-muted">menit</span>
                </span>
              ) : null}
            </label>
          ))}
        </div>

        <p className="mt-3 text-sm font-semibold">
          Waktu yang akan dipakai:{' '}
          {timingMode === 'custom' && durasi === null
            ? 'isi jumlah menit yang valid'
            : durasi === null
              ? 'tanpa batas'
              : humanizeDuration(durasi)}
        </p>

        <label className="mt-5 block">
          <span className="mb-1.5 block text-sm font-semibold">Tenggat (opsional)</span>
          <span className="mb-2 block text-sm text-muted">
            Hari terakhir untuk menyelesaikan. Hanya pengingat: murid tetap bisa mengerjakan
            sesudahnya, tetapi tugas ditandai terlambat.
          </span>
          <input
            type="date"
            value={tenggat}
            onChange={(event) => setTenggat(event.target.value)}
            className="rounded-xl border border-line bg-surface2 px-4 py-2.5"
          />
        </label>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Pratinjau ketersediaan soal</h2>
            <p className="text-sm text-muted">
              Memeriksa berapa soal baru yang masih tersedia untuk tiap murid.
            </p>
          </div>
          <button
            type="button"
            onClick={lihatKetersediaan}
            disabled={pending || terpilih.length === 0 || totalSoal === 0}
            className="rounded-lg border border-line px-4 py-2 text-sm font-semibold transition hover:border-brand disabled:opacity-50"
          >
            Periksa
          </button>
        </div>

        {availability && availability.length > 0 ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[26rem] text-sm">
              <thead>
                <tr className="text-left text-muted">
                  <th className="pb-2">Murid</th>
                  {availability[0].perSection.map((section) => (
                    <th key={section.subject} className="pb-2 text-center">
                      {SUBJECT_LABEL[section.subject]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {availability.map((baris) => (
                  <tr key={baris.userId} className="border-t border-line">
                    <td className="py-2 font-medium">{baris.nama}</td>
                    {baris.perSection.map((section) => {
                      const cukup = section.tersedia >= section.diminta;
                      return (
                        <td key={section.subject} className="py-2 text-center">
                          <span
                            className={`rounded-md px-2 py-1 text-xs font-semibold ${
                              cukup ? 'bg-oksoft text-ok' : 'bg-badsoft text-bad'
                            }`}
                          >
                            {section.tersedia} / {section.diminta}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {kurang ? (
          <div className="mt-4 rounded-xl bg-warnsoft p-4">
            <p className="text-sm font-semibold text-warn">
              Sebagian murid kehabisan soal baru yang cocok.
            </p>
            <p className="mt-1 text-sm text-warn">
              Kurangi jumlah soal, longgarkan filter, tambah soal ke bank, atau
              izinkan pengulangan di bawah ini.
            </p>
          </div>
        ) : null}

        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3">
          <input
            type="checkbox"
            checked={allowRepeat}
            onChange={(event) => setAllowRepeat(event.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[var(--brand)]"
          />
          <span className="text-sm">
            <span className="font-medium">Izinkan soal terulang bila stok habis</span>
            <span className="block text-muted">
              Kekurangan diisi dulu dari soal yang pernah dijawab salah, lalu yang paling lama tidak
              muncul. Biarkan mati agar tiap murid dijamin selalu menerima soal yang benar-benar baru.
            </span>
          </span>
        </label>
      </section>

      {error ? (
        <div className="rounded-xl bg-badsoft p-4 text-sm font-medium text-bad">{error}</div>
      ) : null}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={simpan}
          disabled={pending || totalSoal === 0 || terpilih.length === 0}
          className="flex-1 rounded-xl bg-brand px-6 py-3.5 font-bold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {pending
            ? 'Membuat…'
            : `Buat penugasan untuk ${terpilih.length} murid`}
        </button>
      </div>
    </div>
  );
}

function FilterGroup({
  title,
  options,
  selected,
  onToggle,
}: {
  title: string;
  options: { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{title}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const aktif = selected.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onToggle(option.value)}
              aria-pressed={aktif}
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                aktif ? 'border-brand bg-brand text-white' : 'border-line text-muted hover:border-brand'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
