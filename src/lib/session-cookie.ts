/**
 * The session cookie name, in a module of its own.
 *
 * src/proxy.ts needs it, and importing it from src/lib/auth.ts would drag the
 * database client and better-sqlite3 into the proxy bundle.
 */
export const SESSION_COOKIE = 'tka_session';
