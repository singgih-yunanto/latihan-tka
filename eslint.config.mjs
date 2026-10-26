import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

// `next lint` was removed in Next 16; this is the flat config it recommends.
// react-hooks is the rule set that matters most here: it flags impure state
// updaters and missing effect dependencies in the attempt runner.
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts', 'data/**', 'public/**']),
]);
