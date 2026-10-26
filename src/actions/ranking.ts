'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { sqlite } from '@/db/client';
import { RANKING_ENABLED, setSetting } from '@/domain/settings';
import { actionUser } from '@/lib/auth';

/**
 * The admin's controls over the shared ranking board: the global switch and
 * leaving a single student off it.
 */

export type RankingResult = { ok: true; message?: string } | { ok: false; error: string };

const FORBIDDEN: RankingResult = { ok: false, error: 'Hanya admin yang boleh mengatur peringkat.' };

const flag = z.enum(['0', '1']).transform((v) => v === '1');

function refresh(): void {
  for (const path of ['/admin/peringkat', '/wali/peringkat', '/u/peringkat', '/u', '/admin/users']) {
    revalidatePath(path);
  }
  // The parent menu link lives in the layout.
  revalidatePath('/wali', 'layout');
}

export async function setRankingEnabled(formData: FormData): Promise<RankingResult> {
  const me = await actionUser();
  if (!me || me.role !== 'admin') return FORBIDDEN;

  const parsed = z.object({ enabled: flag }).safeParse({ enabled: formData.get('enabled') });
  if (!parsed.success) return { ok: false, error: 'Pilihan tidak dikenal.' };

  setSetting(sqlite, RANKING_ENABLED, parsed.data.enabled ? '1' : '0');
  refresh();
  return { ok: true };
}

export async function setRankingHidden(formData: FormData): Promise<RankingResult> {
  const me = await actionUser();
  if (!me || me.role !== 'admin') return FORBIDDEN;

  const parsed = z
    .object({ id: z.coerce.number().int().positive(), hidden: flag })
    .safeParse({ id: formData.get('id'), hidden: formData.get('hidden') });
  if (!parsed.success) return { ok: false, error: 'Akun tidak ditemukan.' };

  const result = sqlite
    .prepare("UPDATE users SET ranking_hidden = ? WHERE id = ? AND role = 'student'")
    .run(parsed.data.hidden ? 1 : 0, parsed.data.id);
  if (result.changes === 0) return { ok: false, error: 'Hanya akun murid yang tampil di peringkat.' };

  refresh();
  return { ok: true };
}
