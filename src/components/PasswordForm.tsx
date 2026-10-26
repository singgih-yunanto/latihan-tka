'use client';

import { useActionState } from 'react';
import { changePassword, type AuthState } from '@/actions/auth';

const EMPTY: AuthState = {};

const FIELD =
  'w-full rounded-xl border border-line bg-surface2 px-4 py-3 outline-none focus:border-brand';

export default function PasswordForm({ minLength }: { minLength: number }) {
  const [state, formAction, pending] = useActionState(changePassword, EMPTY);

  return (
    <form action={formAction} className="mt-6 space-y-4">
      <div>
        <label htmlFor="sandiLama" className="mb-1.5 block text-sm font-medium">
          Kata sandi sekarang
        </label>
        <input
          id="sandiLama"
          name="sandiLama"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          className={FIELD}
        />
      </div>

      <div>
        <label htmlFor="sandiBaru" className="mb-1.5 block text-sm font-medium">
          Kata sandi baru
        </label>
        <input
          id="sandiBaru"
          name="sandiBaru"
          type="password"
          autoComplete="new-password"
          minLength={minLength}
          required
          className={FIELD}
        />
        <p className="mt-1 text-xs text-muted">Minimal {minLength} karakter.</p>
      </div>

      <div>
        <label htmlFor="sandiUlang" className="mb-1.5 block text-sm font-medium">
          Ulangi kata sandi baru
        </label>
        <input
          id="sandiUlang"
          name="sandiUlang"
          type="password"
          autoComplete="new-password"
          minLength={minLength}
          required
          className={FIELD}
        />
      </div>

      {state.error ? (
        <p role="alert" className="rounded-lg bg-badsoft px-3 py-2 text-sm text-bad">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-xl bg-brand px-4 py-3 font-semibold text-white disabled:opacity-60"
      >
        {pending ? 'Menyimpan...' : 'Simpan kata sandi'}
      </button>
    </form>
  );
}
