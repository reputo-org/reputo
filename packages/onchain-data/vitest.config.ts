import { createVitestConfig } from '../../vitest.base';

export default createVitestConfig({
  name: '@reputo/onchain-data',
  testTimeout: 120_000,
  hookTimeout: 120_000,
});
