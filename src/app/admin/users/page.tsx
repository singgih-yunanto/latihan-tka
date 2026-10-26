import { eq, sql } from 'drizzle-orm';
import { db, sqlite } from '@/db/client';
import { attempts, userQuestionHistory, users } from '@/db/schema';
import {
  createUser,
  linkChild,
  resetUserPassword,
  setUserActive,
  unlinkChild,
  updateUser,
} from '@/actions/users';
import { setRankingHidden } from '@/actions/ranking';
import { ActionForm } from '@/components/ActionForm';
import { ROLES, ROLE_LABEL, type Role } from '@/domain/access';
import { requireUser } from '@/lib/auth';
import { avatarClass, formatDateTime, initials } from '@/lib/ui';

export const dynamic = 'force-dynamic';

const ROLE_BADGE: Record<Role, string> = {
  admin: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  parent: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  student: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
};

const INPUT =
  'min-h-10 min-w-0 rounded-xl border border-line bg-surface2 px-3 py-2 text-base outline-none focus:border-brand sm:text-sm';

export default async function KelolaAkunPage() {
  const me = await requireUser('admin');

  const daftar = db
    .select({
      user: users,
      attemptSelesai: sql<number>`SUM(CASE WHEN ${attempts.status} = 'selesai' THEN 1 ELSE 0 END)`,
      rata: sql<number>`AVG(${attempts.scorePercent})`,
    })
    .from(users)
    .leftJoin(attempts, eq(attempts.userId, users.id))
    .groupBy(users.id)
    .orderBy(users.role, users.nama)
    .all();

  const riwayat = db
    .select({ userId: userQuestionHistory.userId, n: sql<number>`COUNT(*)` })
    .from(userQuestionHistory)
    .groupBy(userQuestionHistory.userId)
    .all();
  const riwayatByUser = new Map(riwayat.map((row) => [row.userId, Number(row.n)]));

  const links = sqlite
    .prepare(
      `SELECT pc.parent_id AS parentId, pc.student_id AS studentId, u.nama AS studentNama
         FROM parent_children pc
         JOIN users u ON u.id = pc.student_id
        ORDER BY u.nama`,
    )
    .all() as { parentId: number; studentId: number; studentNama: string }[];

  const childrenOf = new Map<number, { id: number; nama: string }[]>();
  for (const link of links) {
    const list = childrenOf.get(link.parentId) ?? [];
    list.push({ id: link.studentId, nama: link.studentNama });
    childrenOf.set(link.parentId, list);
  }

  const murid = daftar.filter(({ user }) => user.role === 'student');
  const orangTua = daftar.filter(({ user }) => user.role === 'parent');
  const belumGanti = daftar.filter(({ user }) => user.mustChangePassword && user.aktif).length;

  return (
    <div>
      <h1 className="text-2xl font-bold">Kelola akun</h1>
      <p className="mt-1 text-sm text-muted">
        Semua akun dibuat di sini. Tiap akun baru, atau yang kata sandinya diatur ulang, mendapat
        kata sandi sementara sendiri yang ditampilkan sekali saja, berlaku 7 hari, dan wajib diganti
        saat pertama masuk.
      </p>

      {belumGanti > 0 ? (
        <p className="mt-3 rounded-xl bg-warnsoft px-4 py-2.5 text-sm text-warn">
          {belumGanti} akun masih memakai kata sandi sementara.
        </p>
      ) : null}

      <ActionForm
        action={createUser}
        className="mt-5 grid gap-3 rounded-2xl border border-line bg-surface p-4 sm:flex sm:flex-wrap sm:items-end sm:gap-2"
      >
        <div className="min-w-0 flex-1">
          <label htmlFor="nama-baru" className="mb-1 block text-xs font-medium text-muted">
            Nama lengkap
          </label>
          <input id="nama-baru" name="nama" required placeholder="Nama" className={`${INPUT} w-full`} />
        </div>
        <div className="min-w-0">
          <label htmlFor="username-baru" className="mb-1 block text-xs font-medium text-muted">
            Nama pengguna
          </label>
          <input
            id="username-baru"
            name="username"
            placeholder="otomatis"
            autoCapitalize="none"
            spellCheck={false}
            className={`${INPUT} w-full sm:w-auto`}
          />
        </div>
        <div className="min-w-0">
          <label htmlFor="role-baru" className="mb-1 block text-xs font-medium text-muted">
            Peran
          </label>
          <select id="role-baru" name="role" defaultValue="student" className={`${INPUT} w-full sm:w-auto`}>
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABEL[role]}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="w-full rounded-xl bg-brand px-5 py-2.5 font-semibold text-white sm:w-auto">
          Tambah akun
        </button>
      </ActionForm>

      <ul className="mt-5 space-y-3">
        {daftar.map(({ user, attemptSelesai, rata }) => {
          const anak = childrenOf.get(user.id) ?? [];
          const role = user.role as Role;

          return (
            <li
              key={user.id}
              className={`rounded-2xl border border-line bg-surface p-4 ${user.aktif ? '' : 'opacity-60'}`}
            >
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full font-bold text-white ${avatarClass(user.avatarWarna)}`}
                  aria-hidden="true"
                >
                  {initials(user.nama)}
                </span>

                <ActionForm action={updateUser} className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={user.id} />
                  <input
                    name="nama"
                    defaultValue={user.nama}
                    aria-label={`Nama ${user.nama}`}
                    className={`${INPUT} w-full font-semibold sm:w-auto sm:min-w-[8rem] sm:flex-1`}
                  />
                  <input
                    name="username"
                    defaultValue={user.username ?? ''}
                    aria-label={`Nama pengguna ${user.nama}`}
                    autoCapitalize="none"
                    spellCheck={false}
                    className={`${INPUT} min-w-[7rem] flex-1 sm:w-28 sm:min-w-0 sm:flex-none`}
                  />
                  {user.id === me.id ? (
                    <span className={`rounded-md px-2 py-1 text-xs font-semibold ${ROLE_BADGE[role]}`}>
                      {ROLE_LABEL[role]} (kamu)
                    </span>
                  ) : (
                    <select name="role" defaultValue={role} aria-label={`Peran ${user.nama}`} className={INPUT}>
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    type="submit"
                    className="min-h-10 rounded-lg border border-line px-3 py-2 text-sm font-medium transition hover:border-brand"
                  >
                    Simpan
                  </button>
                </ActionForm>

                <div className="w-full text-sm sm:w-auto sm:text-right">
                  {role === 'student' ? (
                    <>
                      <p className="font-medium">{Number(attemptSelesai ?? 0)} tugas selesai</p>
                      <p className="text-xs text-muted">
                        {rata ? `rata-rata ${Math.round(Number(rata) * 10) / 10}` : 'belum ada nilai'}
                        {' · '}
                        {riwayatByUser.get(user.id) ?? 0} soal pernah diterima
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-muted">
                      {user.lastLoginAt ? `terakhir masuk ${formatDateTime(user.lastLoginAt)}` : 'belum pernah masuk'}
                    </p>
                  )}
                </div>

                <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                  <ActionForm action={resetUserPassword}>
                    <input type="hidden" name="id" value={user.id} />
                    <button
                      type="submit"
                      className="rounded-lg border border-line px-3 py-2 text-sm font-medium transition hover:border-brand"
                    >
                      Reset sandi
                    </button>
                  </ActionForm>

                  {user.id === me.id ? null : (
                    <ActionForm action={setUserActive}>
                      <input type="hidden" name="id" value={user.id} />
                      <input type="hidden" name="aktif" value={user.aktif ? '0' : '1'} />
                      <button
                        type="submit"
                        className="rounded-lg border border-line px-3 py-2 text-sm font-medium transition hover:border-brand"
                      >
                        {user.aktif ? 'Nonaktifkan' : 'Aktifkan'}
                      </button>
                    </ActionForm>
                  )}

                  {role === 'student' ? (
                    <ActionForm action={setRankingHidden}>
                      <input type="hidden" name="id" value={user.id} />
                      <input type="hidden" name="hidden" value={user.rankingHidden ? '0' : '1'} />
                      <button
                        type="submit"
                        className="rounded-lg border border-line px-3 py-2 text-sm font-medium transition hover:border-brand"
                      >
                        {user.rankingHidden ? 'Tampilkan di peringkat' : 'Sembunyikan dari peringkat'}
                      </button>
                    </ActionForm>
                  ) : null}
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                <span className={`rounded-md px-2 py-0.5 font-semibold ${ROLE_BADGE[role]}`}>
                  {ROLE_LABEL[role]}
                </span>
                {user.mustChangePassword ? (
                  <span className="rounded-md bg-warnsoft px-2 py-0.5 font-semibold text-warn">
                    kata sandi sementara
                  </span>
                ) : null}
                {!user.aktif ? <span>nonaktif</span> : null}
              </div>

              {role === 'parent' ? (
                <div className="mt-3 rounded-xl bg-surface2 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                    Anak yang dipantau
                  </p>

                  {anak.length === 0 ? (
                    <p className="mt-1 text-sm text-muted">Belum ada anak yang dihubungkan.</p>
                  ) : (
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {anak.map((child) => (
                        <li key={child.id}>
                          <ActionForm action={unlinkChild} className="flex items-center gap-1 rounded-lg bg-surface py-1.5 pl-2.5 pr-1.5">
                            <input type="hidden" name="parentId" value={user.id} />
                            <input type="hidden" name="studentId" value={child.id} />
                            <span className="text-sm break-words">{child.nama}</span>
                            <button
                              type="submit"
                              aria-label={`Putuskan ${child.nama} dari ${user.nama}`}
                              className="-my-1 -mr-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-lg text-muted transition hover:text-bad"
                            >
                              &times;
                            </button>
                          </ActionForm>
                        </li>
                      ))}
                    </ul>
                  )}

                  {murid.length > 0 ? (
                    <ActionForm action={linkChild} className="mt-2 flex flex-wrap gap-2">
                      <input type="hidden" name="parentId" value={user.id} />
                      <select name="studentId" aria-label={`Tambah anak untuk ${user.nama}`} className={`${INPUT} flex-1 sm:flex-none`}>
                        {murid.map((row) => (
                          <option key={row.user.id} value={row.user.id}>
                            {row.user.nama}
                          </option>
                        ))}
                      </select>
                      <button
                        type="submit"
                        className="rounded-lg border border-line px-3 py-2 text-sm font-medium transition hover:border-brand"
                      >
                        Hubungkan
                      </button>
                    </ActionForm>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {orangTua.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-line bg-surface p-4 text-sm text-muted">
          Belum ada akun orang tua. Tambahkan satu, lalu hubungkan dengan anaknya agar mereka bisa
          memberi tugas dan memantau hasilnya.
        </p>
      ) : null}
    </div>
  );
}
