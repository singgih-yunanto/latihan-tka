import type { NextConfig } from 'next';

/**
 * APP_ORIGIN must be set on a server (e.g. https://203.0.113.10).
 * Without it Server Actions are rejected when the app is reached through a
 * reverse proxy, because Next compares the Origin header against Host.
 */
const appOrigin = process.env.APP_ORIGIN;

const nextConfig: NextConfig = {
  output: 'standalone',
  // jsdom (used by the SVG sanitiser) loads files at runtime and breaks when
  // bundled, so it is required from node_modules like the native SQLite driver.
  serverExternalPackages: ['better-sqlite3', 'jsdom', 'dompurify'],

  // Note: Next's file tracing pulls ./data into the standalone artefact,
  // because the default database path is statically resolvable.
  // outputFileTracingExcludes does not catch it, so deploy/deploy.sh removes
  // that directory and production requires TKA_DB_PATH to be set.
  experimental: {
    serverActions: {
      allowedOrigins: appOrigin
        ? [new URL(appOrigin).host]
        : undefined,
      bodySizeLimit: '4mb',
    },
  },
};

export default nextConfig;
