'use client';

import { useActionState } from 'react';
import { signIn, type AuthState } from '@/actions/auth';

const EMPTY: AuthState = {};

export default function SignInForm({ lanjut }: { lanjut?: string }) {
  const [state, formAction, pending] = useActionState(signIn, EMPTY);

  return (
    <form action={formAction} className="mt-6 space-y-4">
      {lanjut ? <input type="hidden" name="lanjut" value={lanjut} /> : null}

      <div>
        <label htmlFor="username" className="mb-1.5 block text-sm font-medium">
          Nama pengguna
        </label>
        <input
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus
          required
          className="w-full rounded-xl border border-line bg-surface2 px-4 py-3 outline-none focus:border-brand"
        />
      </div>

      <div>
        <label htmlFor="password" className="mb-1.5 block text-sm font-medium">
          Kata sandi
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="w-full rounded-xl border border-line bg-surface2 px-4 py-3 outline-none focus:border-brand"
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
        {pending ? 'Memeriksa...' : 'Masuk'}
      </button>
    </form>
  );
}
