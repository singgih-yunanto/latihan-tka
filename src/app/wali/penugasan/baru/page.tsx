import Link from 'next/link';
import { AssignmentForm } from '@/components/AssignmentForm';
import { requireUser } from '@/lib/auth';
import { assignmentFormData, presetFromSearch } from '@/lib/queries/assignment-form';

export const dynamic = 'force-dynamic';

/**
 * The same assignment form the admin uses, with the student list narrowed to
 * this parent's own children. `createAssignment` re-checks that list, so the
 * narrowing here is convenience rather than the actual protection.
 */
export default async function WaliBuatPenugasanPage({
  searchParams,
}: {
  searchParams: Promise<{ untuk?: string; latih?: string }>;
}) {
  const me = await requireUser('parent');
  const { blueprint, students } = assignmentFormData(me);
  const preset = presetFromSearch(await searchParams);

  if (students.length === 0) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-8 text-center">
        <h1 className="text-xl font-bold">Belum ada anak yang terhubung</h1>
        <p className="mt-2 text-sm text-muted">
          Minta admin menghubungkan akunmu dengan akun anakmu lebih dulu.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <Link href="/wali" className="text-sm text-muted underline underline-offset-4">
          ← Kembali ke ringkasan
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Beri tugas</h1>
        <p className="mt-1 text-sm text-muted">
          Tentukan jumlah soal per mata pelajaran, pilih anak, lalu atur batas waktunya.
        </p>
      </div>

      <AssignmentForm blueprint={blueprint} users={students} doneHref="/wali" preset={preset} />
    </div>
  );
}
