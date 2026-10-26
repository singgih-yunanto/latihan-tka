import Link from 'next/link';
import { AssignmentForm } from '@/components/AssignmentForm';
import { requireUser } from '@/lib/auth';
import { assignmentFormData, presetFromSearch } from '@/lib/queries/assignment-form';

export const dynamic = 'force-dynamic';

export default async function BuatPenugasanPage({
  searchParams,
}: {
  searchParams: Promise<{ untuk?: string; latih?: string }>;
}) {
  const me = await requireUser('admin');
  const { blueprint, students } = assignmentFormData(me);
  const preset = presetFromSearch(await searchParams);

  return (
    <div>
      <div className="mb-6">
        <Link href="/admin/penugasan" className="text-sm text-muted underline underline-offset-4">
          ← Kembali ke daftar penugasan
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Buat penugasan baru</h1>
        <p className="mt-1 text-sm text-muted">
          Tentukan jumlah soal per mata pelajaran, pilih murid, lalu atur batas waktunya.
        </p>
      </div>

      <AssignmentForm blueprint={blueprint} users={students} preset={preset} />
    </div>
  );
}
