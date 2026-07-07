import { resolve } from 'node:path';
import { createVitestConfig } from '../../vitest.base';

export default createVitestConfig({
  name: '@reputo/workflows',
  include: ['tests/unit/**/*.test.ts'],
  coverageExclude: ['src/workers/typescript/*.worker.ts'],
  resolve: {
    alias: {
      '@reputo/reputation-algorithms': resolve(__dirname, '../../packages/reputation-algorithms/src/index.ts'),
    },
  },
});
