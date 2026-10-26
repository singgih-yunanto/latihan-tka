/**
 * Validates a `?lanjut=` target so sign-in cannot bounce to another site.
 *
 * Only a same-origin path is accepted. Browsers treat a backslash like a slash,
 * so `/\evil.com` means `//evil.com` -- a protocol-relative URL to another
 * host -- and is rejected along with `//`. Resolving against a dummy origin and
 * comparing catches whatever else a parser might read as a host.
 */
export function safeNextPath(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null;
  if (/[\u0000-\u001f]/.test(raw)) return null;
  try {
    const base = 'http://tka.invalid';
    const url = new URL(raw, base);
    if (url.origin !== base) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
