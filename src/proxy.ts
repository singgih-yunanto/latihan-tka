import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/session-cookie';

/**
 * Runs in front of every page: sets the security headers, and is the coarse
 * gate in front of every signed-in area.
 *
 * This file uses Next 16's `proxy` convention, which replaced `middleware`.
 *
 * The gate only checks that a session cookie is *present*, never whether it is
 * valid: the database lives behind `better-sqlite3`, and importing a native
 * module here would drag it into the proxy bundle and upset standalone file
 * tracing. That is why the cookie name comes from a leaf module rather than
 * lib/auth.
 *
 * Nothing is lost by that. The authoritative checks are `requireUser` on every
 * page and, above all, the guards inside every Server Action -- Server Actions
 * are publicly callable endpoints, so they can never rely on this file. What
 * this gate buys is the common case: a signed-out visitor is sent to /masuk
 * without rendering anything.
 *
 * The Content Security Policy is the backstop for the HTML this app inlines on
 * purpose (question figures, KaTeX, rendered markdown): even if something got
 * past the sanitiser, a script without this request's nonce does not run.
 * Inline style attributes stay allowed because KaTeX and the progress bars
 * depend on them; styles cannot run code.
 */

const PROTECTED = ['/admin', '/wali', '/u', '/akun'];

function contentSecurityPolicy(nonce: string): string {
  const isDev = process.env.NODE_ENV === 'development';
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function withSecurityHeaders(response: NextResponse, csp: string): NextResponse {
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'same-origin');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  return response;
}

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = contentSecurityPolicy(nonce);

  const needsSession = PROTECTED.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (needsSession && !request.cookies.get(SESSION_COOKIE)?.value) {
    // A POST here is a Server Action call; answering with a redirect to a
    // login page would be meaningless to the client, so refuse it outright.
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return withSecurityHeaders(new NextResponse('Unauthorized', { status: 401 }), csp);
    }

    const url = request.nextUrl.clone();
    url.pathname = '/masuk';
    url.search = '';
    if (pathname !== '/') url.searchParams.set('lanjut', pathname);
    return withSecurityHeaders(NextResponse.redirect(url), csp);
  }

  // Next reads the nonce from the request's CSP header and stamps it on the
  // scripts it renders, which is why every page here renders dynamically.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  return withSecurityHeaders(NextResponse.next({ request: { headers: requestHeaders } }), csp);
}

export const config = {
  matcher: [
    {
      // Everything but build assets and files served straight from public/.
      source: '/((?!_next/static|_next/image|favicon.ico|bank-assets/).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
