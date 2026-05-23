import { createVitestConfig } from '../../vitest.base'

export default createVitestConfig({
  name: '@reputo/contracts',
  include: ['tests/**/*.test.ts'],
  coverageInclude: ['src/**/*.ts'],
})
