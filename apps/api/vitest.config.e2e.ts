import { resolve } from 'node:path';
import swc from 'unplugin-swc';
import tsconfigPaths from 'vite-tsconfig-paths';
import { createVitestConfig } from '../../vitest.base';

export default createVitestConfig({
  name: '@reputo/api-e2e',
  include: ['tests/e2e/**/*.test.ts'],
  coverageExclude: ['src/main.ts', 'src/config/**'],
  globalSetup: ['./tests/global-setup.ts'],
  setupFiles: ['./tests/setup.ts'],
  testTimeout: 30_000,
  hookTimeout: 120_000,
  poolOptions: {
    forks: {
      singleFork: true,
      execArgv: ['--max-old-space-size=8192', '--expose-gc'],
    },
  },
  isolate: false,
  fileParallelism: false,
  plugins: [swc.vite({ module: { type: 'es6' } }), tsconfigPaths()],
  resolve: {
    alias: {
      src: resolve(__dirname, './src'),
      '@reputo/contracts': resolve(__dirname, '../../packages/contracts/src/index.ts'),
      '@reputo/reputation-algorithms': resolve(__dirname, '../../packages/reputation-algorithms/src/index.ts'),
      '@reputo/storage': resolve(__dirname, '../../packages/storage/src/index.ts'),
      '@reputo/algorithm-validator': resolve(__dirname, '../../packages/algorithm-validator/src/index.ts'),
    },
  },
});
