import { createVitestConfig } from '../../vitest.base'

export default createVitestConfig({
    name: '@reputo/env',
    include: ['tests/**/*.test.ts'],
    coverageInclude: ['src/**/*.ts'],
})
