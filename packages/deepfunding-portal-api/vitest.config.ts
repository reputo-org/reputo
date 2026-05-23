import { createVitestConfig } from '../../vitest.base';

export default createVitestConfig({
  name: '@reputo/deepfunding-portal-api',
  include: ['tests/**/*.test.ts'],
  coverageInclude: ['src/**/*.ts'],
  coverageExclude: ['src/shared/types/**/*.ts'],
  testTimeout: 30_000,
  hookTimeout: 30_000,
});

