import { createVitestConfig } from '../../vitest.base';

export default createVitestConfig({
  name: '@reputo/deep-id-api',
  testTimeout: 30_000,
  hookTimeout: 30_000,
});
