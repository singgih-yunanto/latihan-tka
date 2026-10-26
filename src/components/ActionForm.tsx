'use client';

import { useActionState } from 'react';
import { CopyButton } from '@/components/CopyButton';

/**
 * A form that shows what its Server Action said.
 *
 * The admin actions refuse work for real reasons -- a username already taken,
 * an account that may not be deactivated -- and a plain `<form action={...}>`
 * throws that answer away, leaving the page looking like nothing happened.
 */

export type ActionResult =
  | { ok: true; message?: string; credential?: { username: string; password: string } }
  | { ok: false; error: string };

/** A freshly issued one-time password, with buttons to copy it. */
function IssuedCredential({ username, password }: { username: string; password: string }) {
  return (
    <div role="status" className="mt-2 w-full rounded-xl border border-ok/40 bg-oksoft p-3 text-sm">
      <dl className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2">
        <dt className="text-muted">Nama pengguna</dt>
        <dd className="min-w-0 select-all break-all font-mono font-semibold">{username}</dd>
        <CopyButton value={username} label="Salin" />
        <dt className="text-muted">Kata sandi</dt>
        <dd className="min-w-0 select-all break-all font-mono font-semibold">{password}</dd>
        <CopyButton value={password} label="Salin" />
      </dl>
      <CopyButton
        value={`Nama pengguna: ${username}\nKata sandi: ${password}`}
        label="Salin keduanya"
        className="mt-3"
      />
    </div>
  );
}

type Props = {
  action: (formData: FormData) => Promise<ActionResult>;
  children: React.ReactNode;
  className?: string;
};

export function ActionForm({ action, children, className }: Props) {
  const [state, formAction] = useActionState(
    async (_prev: ActionResult | null, formData: FormData) => action(formData),
    null,
  );

  return (
    <>
      <form action={formAction} className={className}>
        {children}
      </form>

      {state && !state.ok ? (
        <p role="alert" className="mt-1 w-full text-xs font-medium text-bad">
          {state.error}
        </p>
      ) : null}
      {state?.ok && state.credential ? <IssuedCredential {...state.credential} /> : null}
      {state?.ok && state.message ? (
        <p className="mt-1 w-full select-all text-xs font-medium text-ok">{state.message}</p>
      ) : null}
    </>
  );
}
