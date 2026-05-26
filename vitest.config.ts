import { defineConfig } from 'vitest/config';
import { extendCoverageExcludes } from './vitest.base';

export default defineConfig({
  test: {
    projects: ['packages/*/vitest.config.ts', 'apps/*/vitest.config*.ts'],
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'html', 'lcov'],
      exclude: extendCoverageExcludes(['commitlint.config.mjs', 'scripts/**']),
    },
  },
});
