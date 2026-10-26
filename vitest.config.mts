import path from 'node:path';
import { defineConfig } from 'vitest/config';

// This file uses the .mts extension so it loads as ESM. Recent Vite versions
// load the config natively and would treat a .ts file as CommonJS, which makes
// the import syntax here emit a warning.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
});
